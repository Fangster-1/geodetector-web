@echo off
title GD Web - Service Window (please keep open)
cd /d "%~dp0"

set "RSCRIPT=D:\Program Files\R\R-4.5.2\bin\Rscript.exe"
set PORT=8765
set URL=http://127.0.0.1:%PORT%/index.html

echo ============================================================
echo   GeoDetector Analysis ^& Plotting Platform / Local Launcher
echo ============================================================
echo.

if not exist "%RSCRIPT%" (
    echo [ERROR] Rscript not found at:
    echo   %RSCRIPT%
    echo Edit this bat to set RSCRIPT to your Rscript.exe path.
    echo.
    pause
    exit /b 1
)

REM If port already in use, kill the old service so the NEW code is loaded.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    echo [INFO] Old service found on port %PORT% (PID %%P^). Restarting with latest code...
    taskkill /F /PID %%P >nul 2>&1
)
ping -n 2 127.0.0.1 >nul

echo Starting R backend (a new window titled "GD-Server" will appear)...
echo If GD-Server window closes immediately, run this bat again and
echo read the error before it disappears, or run run_app.R in RStudio.
echo.

start "GD-Server" "%RSCRIPT%" "%~dp0run_app.R"

echo Waiting for service to be ready (cold start may take 15-30s)...
set TRIES=0
:WAIT_LOOP
set /a TRIES+=1
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul
if %errorlevel%==0 goto READY
if %TRIES% LSS 40 (
    echo   waited %TRIES%s ...
    goto WAIT_LOOP
)

echo.
echo [ERROR] Service did not start within 60 seconds.
echo Check the "GD-Server" window for the real error.
echo Common cause: missing R packages. Install with:
echo   install.packages(c("plumber","GD","readxl","jsonlite","car"))
echo.
pause
exit /b 1

:READY
echo.
echo [OK] Service is ready. Opening browser...
start "" "%URL%"
echo.
echo URL: %URL%
echo.
echo To stop the service: close the "GD-Server" window.
echo You can close this window now.
timeout /t 5 >nul
exit /b 0