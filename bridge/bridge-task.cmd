@echo off
rem Akij Sales Control Tower - auto-start sync bridge (used by Windows Task Scheduler)
cd /d "%~dp0\.."
node bridge\sync-worker.js >> "%~dp0\..\data\bridge.log" 2>&1
