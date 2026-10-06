@echo off
setlocal
rem ---------------------------------------------------------------------------
rem  ComfyQ - double-click launcher
rem
rem  Starts the ComfyQ server and its web interface, then opens the page.
rem  Keep this window open while you work; closing it stops ComfyQ.
rem
rem  It takes its own folder from %~dp0 and never names a drive, so this file
rem  works wherever the repo sits and under whatever letter the NVMe mounts as.
rem ---------------------------------------------------------------------------

title ComfyQ
cd /d "%~dp0"

echo.
echo   ComfyQ
echo   %CD%
echo.

rem --- Node ------------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js was not found on this machine.
  echo.
  echo   Install the LTS build, which is a DIFFERENT winget package from the
  echo   one called plain OpenJS.NodeJS:
  echo.
  echo       winget install --id OpenJS.NodeJS.LTS --exact
  echo.
  echo   Then open a NEW window and double-click this file again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODEVER=%%v"
echo   Node %NODEVER%

rem --- Already running? ------------------------------------------------------
rem A second copy could only fail on the port it cannot have, so read a
rem double-click as "show me ComfyQ" and just open the page.
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo   ComfyQ is already running - opening the page.
  start "" http://localhost:5173
  timeout /t 3 >nul
  exit /b 0
)

rem --- Dependencies ----------------------------------------------------------
rem npm install here also installs client and server, through the root
rem package.json postinstall. Only the first run on a machine pays for it.
if not exist "node_modules\" goto install
if not exist "client\node_modules\" goto install
if not exist "server\node_modules\" goto install
goto run

:install
echo.
echo   Installing dependencies. First run only, and it takes a few minutes.
echo.
call npm install
if errorlevel 1 (
  echo.
  echo   npm install did not finish - the reason is in the lines above.
  echo.
  pause
  exit /b 1
)

:run
rem Open the page by itself once the interface answers, rather than opening a
rem dead tab now: Vite needs a few seconds, and more on a cold disk.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){ try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:5173' | Out-Null; Start-Process 'http://localhost:5173'; break } catch { Start-Sleep -Seconds 2 } }"

echo.
echo   Starting ComfyQ. The page will open by itself.
echo.
echo     Students    http://localhost:5173
echo     Admin       http://localhost:5173/admin
echo.
echo   On the network, swap localhost for this machine's IP - the admin panel
echo   prints the addresses a moment from now.
echo.
echo   Keep this window open. Closing it, or Ctrl+C, stops ComfyQ.
echo.

call npm run dev

echo.
echo   ComfyQ has stopped.
echo.
pause
