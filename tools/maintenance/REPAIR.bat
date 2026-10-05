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
set PYEXE=..\ComfyUI_windows_portable\python_embeded\python.exe
if not exist "%PYEXE%" (
  echo.
  echo   ERROR: embedded Python not found at %PYEXE%
  echo   Keep this folder next to ComfyUI_windows_portable\ on the same drive.
  echo.
  pause
  exit /b 2
)
"%PYEXE%" -X utf8 "%~dp0repair_all.py" %*
echo.
pause
