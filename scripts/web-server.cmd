@echo off
rem Starts the built web console. Usage: scripts\web-server.cmd [apiUrl] [port]
set ACO_API_URL=%1
if "%ACO_API_URL%"=="" set ACO_API_URL=http://127.0.0.1:4100
set WEB_PORT=%2
if "%WEB_PORT%"=="" set WEB_PORT=3000
cd /d %~dp0..\web
node ..\node_modules\next\dist\bin\next start -p %WEB_PORT% > "%~dp0..\web-server.log" 2>&1
