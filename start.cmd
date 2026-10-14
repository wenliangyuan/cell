@echo off
REM CELL · 生命微观剧场 — local preview launcher.
REM ES modules require an http origin, so we start a tiny static server.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [CELL] 未找到 Node.js。请先安装 Node.js，或用任意静态服务器托管本目录。
  echo        例如:  python -m http.server 8127
  pause
  exit /b 1
)

set PORT=8127
echo [CELL] 正在启动本地预览服务器 http://127.0.0.1:%PORT%/
start "" http://127.0.0.1:%PORT%/
node tools\serve.mjs %PORT% "%~dp0."
