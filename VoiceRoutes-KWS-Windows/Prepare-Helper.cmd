@echo off
setlocal
cd /d "%~dp0"
py -3.11 -I -c "import struct, sys; sys.exit(struct.calcsize('P') != 8)"
if errorlevel 1 (
  echo Install 64-bit Python 3.11 and its Windows py launcher before setup.
  goto failed
)
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -I -m venv ".venv"
  if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -I -m pip --isolated --disable-pip-version-check install --index-url https://pypi.org/simple --require-hashes --only-binary=:all: -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -I -X utf8 prepare_model.py
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -I -c "import numpy, sherpa_onnx, sounddevice"
if errorlevel 1 goto failed
echo.
echo Ready. Open Hey-ChatGPT.exe and select this folder if the app asks.
pause
exit /b 0
:failed
echo.
echo Setup did not finish. Review the error above; rerun this setup once it is resolved.
pause
exit /b 1
