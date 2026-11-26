# Run on a fresh Windows runner. Launch the artifact the player downloads, not
# dev Electron or win-unpacked. Do not override the profile path or lock.
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem 'release/Conquer-Portable-*.exe' -File)
if ($files.Count -ne 1) { throw 'Expected exactly one Windows portable executable' }
$exe = $files[0]
$launcher = Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  $lastTitle = '(no window)'
  do {
    if ($launcher.HasExited) { throw "Portable exited before the title screen (exit $($launcher.ExitCode))." }
    $game = Get-Process -Name 'Conquer Rule the Globe' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    # The BrowserWindow and static HTML initially say 'Starting Conquer'. Only
    # the initialized game renderer sets this final native window caption.
    if ($game) {
      $lastTitle = $game.MainWindowTitle
      if ($lastTitle -ceq 'Conquer: Rule the Globe') { break }
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($lastTitle -cne 'Conquer: Rule the Globe') { throw "Portable did not reach the title screen in 90 seconds. Last window: $lastTitle" }
  Write-Host "$($exe.Name) opened its title screen on Windows."
  $null = $game.Handle # Retain the inner process handle across WM_CLOSE.
  if (-not $game.CloseMainWindow()) { throw 'Windows could not request a close on the game window.' }
  if (-not $game.WaitForExit(30000)) {
    $game.Refresh()
    throw "Game process did not exit after WM_CLOSE. Window: '$($game.MainWindowTitle)'; responding: $($game.Responding)."
  }
  # The self-extractor still has to remove the Electron runtime from TEMP after
  # the game exits. Time it separately from the native window's shutdown.
  if (-not $launcher.WaitForExit(60000)) { throw 'The game exited but portable cleanup did not finish within 60 seconds.' }
  if ($launcher.ExitCode -ne 0) { throw "Portable returned exit $($launcher.ExitCode) after closing the game." }
} catch {
  Write-Host "::error title=Windows portable startup::$($_.Exception.Message)"
  throw
} finally {
  if (-not $launcher.HasExited) { taskkill /PID $launcher.Id /T /F | Out-Null }
  $launcher.Dispose()
}
