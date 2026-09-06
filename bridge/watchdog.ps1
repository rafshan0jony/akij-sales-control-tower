# Akij Sales Control Tower — bridge watchdog (path-agnostic).
# Starts the sync bridge if it is not already running. Register via the
# scheduled task created by setup-server.bat so the bridge always comes back.
$ErrorActionPreference = 'SilentlyContinue'
$bridgeDir = $PSScriptRoot
$proj = Split-Path -Parent $bridgeDir
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'sync-worker' }
if (-not $running) {
  $ts = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'
  Add-Content -Path (Join-Path $proj 'data\bridge.log') -Value "[$ts] [watchdog] bridge not running - starting..."
  Start-Process -FilePath (Join-Path $bridgeDir 'bridge-task.cmd') -WindowStyle Hidden
}
