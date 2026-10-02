@echo off
rem Starts an isolated control-plane instance for testing (separate data dir and port).
rem Usage: scripts\test-server.cmd [port] [background:0|1]
set ACO_DATA_DIR=%~dp0..\test-data
set ACO_PORT=%1
if "%ACO_PORT%"=="" set ACO_PORT=4199
set ACO_DISABLE_BACKGROUND=%2
if "%ACO_DISABLE_BACKGROUND%"=="" set ACO_DISABLE_BACKGROUND=1
cd /d %~dp0..\server
node ..\node_modules\tsx\dist\cli.mjs src\index.ts > "%~dp0..\test-data-server.log" 2>&1
