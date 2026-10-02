@echo off
rem START AI COMPANY — one-click local start (Windows).
title AI Startup Company OS
cd /d %~dp0
where node >nul 2>nul || (echo Node.js 22.5+ is required: https://nodejs.org & pause & exit /b 1)
where git >nul 2>nul || (echo git is required. & pause & exit /b 1)
where docker >nul 2>nul || echo WARNING: Docker Desktop with Linux containers is required for generated apps.
where kiro-cli >nul 2>nul || echo WARNING: kiro-cli not found on PATH. The company will start, but work pauses until Kiro is available.
if not exist node_modules (echo Installing dependencies... & call npm install --no-audit --no-fund || exit /b 1)
rem The web console bakes its /api proxy target in at build time, so always rebuild (fast when unchanged).
echo Building... & call npm run build || exit /b 1
echo Starting control plane (http://127.0.0.1:4100) and owner console (http://localhost:3000)...
start "" http://localhost:3000
call npm start
