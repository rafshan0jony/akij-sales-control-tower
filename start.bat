@echo off
title Akij Essentials - Sales Control Tower
cd /d "%~dp0"
echo Starting Akij Sales Control Tower...
echo.
echo Dashboard will open at:  http://localhost:8080
echo Login: admin  /  admin123
echo Press Ctrl+C to stop.
echo.
start "" http://localhost:8080
node server/index.js
pause
