# Run on a fresh Windows runner. Launch the artifact the player downloads, not
# dev Electron or win-unpacked. Do not override the profile path or lock.
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem 'release/Conquer-Portable-*.exe' -File)
if ($files.Count -ne 1) { throw 'Expected exactly one Windows portable executable' }
$exe = $files[0]
$launcher = Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    if ($launcher.HasExited) { throw "Portable exited before opening a game window (exit $($launcher.ExitCode))." }
    $game = Get-Process -Name 'Conquer Rule the Globe' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ceq 'Conquer: Rule the Globe' } |
      Select-Object -First 1
    if ($game) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $game) { throw 'Portable did not show the game window within 90 seconds.' }
  Write-Host "$($exe.Name) opened the game window on Windows."
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
