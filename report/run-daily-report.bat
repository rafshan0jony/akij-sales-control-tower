@echo off
cd /d "%~dp0\.."
REM Wait for network + bridge data sync after login (90s), then run the daily
REM per-user Product-wise report. The script itself skips if already sent today.
timeout /t 90 /nobreak >nul
node report\daily-product-report.js >> data\daily-report.log 2>&1
