@echo off
REM Opens the model-audit editor in your browser.
REM Decide what goes, press Save, then run prune-models.ps1.
setlocal
cd /d "%~dp0"

REM ComfyUI's bundled python, from ComfyQ's own config. A .bat cannot read
REM JSON, so node (already required by ComfyQ) does the lookup; the old
REM drive-relative guess stays as a fallback.
set "PY="
for /f "usebackq delims=" %%P in (`node "%~dp0..\python-path.js" 2^>nul`) do set "PY=%%P"
if not defined PY set "PY=%~d0\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\python_embeded\python.exe"
if not exist "%PY%" set "PY=python"

echo.
echo   Model audit editor
echo   ------------------
echo   Close this window (or press Ctrl+C) when you are done.
echo.
"%PY%" audit_ui.py
if errorlevel 1 (
  echo.
  echo   Failed to start. Is model-audit.csv present?
  echo   If not, run:  build_csv.py
  pause
)
endlocal
