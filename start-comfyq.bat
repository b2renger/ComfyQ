@echo off
REM ============================================================
REM  start-comfyq.bat
REM  Double-click launcher for ComfyQ on Windows.
REM
REM  Behavior:
REM    1. Switches to the directory this script lives in (so
REM       double-clicking from anywhere works).
REM    2. Runs `npm install` once if node_modules is missing
REM       (fresh clone case).
REM    3. Starts the full stack via `npm run dev`, which uses
REM       `concurrently` to spawn the Express server (port 3000)
REM       + Vite HTTPS dev server (port 5173) in one terminal.
REM    4. On exit, pauses so any error message stays readable.
REM
REM  Notes:
REM    - Vite serves HTTPS via a self-signed cert. First visit
REM      per device: accept the warning (Advanced -> Proceed).
REM    - LAN URLs are printed by the server on startup. Share
REM      those with students on the same WiFi.
REM    - Ctrl+C in this window stops both processes cleanly.
REM ============================================================

title ComfyQ
cd /d "%~dp0"

echo.
echo ============================================
echo    ComfyQ
echo ============================================
echo.

if not exist "node_modules" (
    echo  node_modules not found.
    echo  Running 'npm install' once before launch...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  npm install failed. Check the messages above
        echo  and re-run this script.
        pause
        exit /b 1
    )
    echo.
)

echo  Starting server. Keep this window open.
echo  Press Ctrl+C to stop.
echo.
echo  When ready, open in your browser:
echo    https://localhost:5173
echo.
echo  Watch for LAN URLs printed below; share those
echo  with students on the same network.
echo  Accept the self-signed cert on first visit.
echo ============================================
echo.

call npm run dev

echo.
echo ============================================
echo    ComfyQ stopped.
echo ============================================
pause
