@echo off
setlocal EnableExtensions
title Akij Sales Bridge - Server Setup
cd /d "%~dp0\.."

echo ==============================================
echo   Akij Sales Control Tower - Bridge Setup
echo ==============================================
echo.

REM 1. Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo.
  echo  Install steps:
  echo   1. Open https://nodejs.org
  echo   2. Download the LTS version (22 or newer)
  echo   3. Install (keep all defaults)
  echo   4. Re-run this script
  echo.
  pause
  exit /b 1
)
echo [OK] Node.js found.
for /f "delims=" %%v in ('node -v') do echo       version: %%v

REM 2. Install dependencies (only needs internet the first time)
echo.
echo Installing dependencies (first time takes a minute)...
call npm install --omit=dev
if errorlevel 1 (
  echo [ERROR] npm install failed. Check internet and retry.
  pause
  exit /b 1
)
echo [OK] Dependencies ready.

REM 3. Register auto-restart watchdog (scheduled task, every 5 min)
echo.
echo Registering auto-restart watchdog...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = (Resolve-Path '%~dp0watchdog.ps1').Path; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $p + '\"'); $trg = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650); Register-ScheduledTask -TaskName 'Akij-Sales-Bridge-Watchdog' -Action $act -Trigger $trg -Force | Out-Null"
echo [OK] Watchdog registered.

REM 4. Start the bridge now
echo.
echo Starting bridge...
start /min "" node bridge\sync-worker.js >> data\bridge.log 2>&1

echo.
echo ==============================================
echo   DONE. The bridge is running on this server.
echo   It auto-starts and auto-restarts every 5 min.
echo ==============================================
echo.
timeout /t 6 >nul
