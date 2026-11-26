# Run on a fresh Windows runner. Launch the artifact the player downloads, not
# dev Electron or win-unpacked. Do not override the profile path or lock.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
function Wait-ForGameButton($window, [string]$name) {
  $condition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($button) { return $button }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Game window did not render the '$name' button."
}

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
  # A caption alone could be a blank BrowserWindow. Drive the real, accessible
  # title screen without opening DevTools or passing diagnostic flags to the exe.
  $window = [System.Windows.Automation.AutomationElement]::FromHandle($game.MainWindowHandle)
  $newGame = Wait-ForGameButton $window 'NEW CAMPAIGN'
  $newGame.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $null = Wait-ForGameButton $window 'BEGIN CAMPAIGN'
  Write-Host "$($exe.Name) opened the title screen and reached nation selection."
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
