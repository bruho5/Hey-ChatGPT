@echo off
setlocal
"%~dp0Chrome-Link.exe"
set "rc=%errorlevel%"
echo.
pause
exit /b %rc%
