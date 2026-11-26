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
  if (-not $game.CloseMainWindow() -or -not $launcher.WaitForExit(20000) -or $launcher.ExitCode -ne 0) {
    throw 'The portable did not close cleanly after closing the game window.'
  }
} catch {
  Write-Host "::error title=Windows portable startup::$($_.Exception.Message)"
  throw
} finally {
  if (-not $launcher.HasExited) { taskkill /PID $launcher.Id /T /F | Out-Null }
  $launcher.Dispose()
}
