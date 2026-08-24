@echo off
title Akij Sales Control Tower - Sync Bridge
cd /d "%~dp0"
echo Starting Akij Sales Control Tower - Sync Bridge...
echo This keeps your online dashboard updated every 5 minutes.
echo Keep this window open (minimize it). Close to stop syncing.
echo.
node bridge/sync-worker.js
pause
