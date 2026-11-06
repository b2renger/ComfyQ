@echo off
REM ==========================================================================
REM  Double-click me after ANY update (ComfyUI core, a custom-node pack, or
REM  ComfyUI-Manager "update all").
REM
REM  This install carries hand-fixes that every one of those updates silently
REM  reverts. repair_all.py checks each one, re-applies what is missing, and
REM  health-checks the pinned PyTorch/CUDA stack. It is safe to run any time --
REM  when nothing is broken it changes nothing.
REM
REM  Pass --check to see what WOULD be repaired without writing anything:
REM      REPAIR.bat --check
REM ==========================================================================
setlocal
cd /d "%~dp0"
REM ComfyUI's bundled python, from ComfyQ's own config (Manage ComfyUI ->
REM ComfyUI Settings), else from an install beside this checkout. A .bat
REM cannot read JSON, so node (already required by ComfyQ) does the lookup --
REM the same way model-audit\AUDIT.bat does it. Without node, the same two
REM layouts beside the checkout are tried here.
set "PYEXE="
for /f "usebackq delims=" %%P in (`node "%~dp0python-path.js" 2^>nul`) do set "PYEXE=%%P"
if not defined PYEXE if exist "%~dp0..\..\..\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\python_embeded\python.exe" set "PYEXE=%~dp0..\..\..\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\python_embeded\python.exe"
if not defined PYEXE set "PYEXE=%~dp0..\..\..\ComfyUI_windows_portable\python_embeded\python.exe"
if not exist "%PYEXE%" (
  echo.
  echo   ERROR: ComfyUI's embedded Python was not found.
  echo   Set the ComfyUI path in ComfyQ: Admin, Manage ComfyUI, ComfyUI Settings.
  echo   It is stored as comfy_ui.root_path in ComfyQ's config.json.
  echo.
  pause
  exit /b 2
)
"%PYEXE%" -X utf8 "%~dp0repair_all.py" %*
echo.
pause
