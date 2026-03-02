@echo off
title Stellar Memory
cd /d "C:\Users\USER\stm"

netstat -ano 2>nul | findstr "LISTENING" | findstr ":21547 " >nul 2>&1
if not errorlevel 1 (
    start "" http://localhost:21547
    exit /b 0
)

echo.
echo   Stellar Memory
echo   ================================
echo   Starting server on port 21547...
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Node.js not found in PATH.
    pause
    exit /b 1
)

if not exist "dist\api\server.js" (
    echo   [ERROR] dist\api\server.js not found.
    echo   Run: npm run build
    pause
    exit /b 1
)

start "" /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://localhost:21547"

echo   Server starting...
echo   Close this window to stop.
echo.
node dist/api/server.js

echo.
echo   [ERROR] Server stopped unexpectedly.
pause
