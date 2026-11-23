@echo off
setlocal
"%~dp0Chrome-Link.exe" -remove
set "rc=%errorlevel%"
echo.
pause
exit /b %rc%
