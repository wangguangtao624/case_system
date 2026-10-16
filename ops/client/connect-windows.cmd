@echo off
setlocal
title Case System - Windows to server 38
where ssh.exe >nul 2>nul
if errorlevel 1 (
  echo OpenSSH client was not found. Ask Codex on this Windows PC to configure it.
  pause
  exit /b 1
)
echo This script must run on your Windows PC, not in a remote VS Code terminal.
echo Connecting to development and monitoring server 10.26.10.38...
echo Use the SSH account password only if SSH asks. No password is stored here.
echo.
echo After authentication, keep this window open and visit:
echo Monitoring:  http://localhost:52444/
echo Staging:     http://localhost:5001/
echo Development: http://localhost:5002/  (only while a dev server is running)
echo.
ssh.exe -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:52444:127.0.0.1:8765 -L 127.0.0.1:5001:127.0.0.1:5001 -L 127.0.0.1:5002:127.0.0.1:5002 wangguangtao@10.26.10.38
set "CASE_SSH_EXIT=%ERRORLEVEL%"
echo.
echo The viewing connection has ended. Server services continue running.
if not "%CASE_SSH_EXIT%"=="0" echo Check the SSH error above. Do not terminate an occupied port without identifying its owner.
pause
exit /b %CASE_SSH_EXIT%
