@echo off
rem SongLearn 本地对齐后端一键启动：建 venv → 装依赖 → 起 Flask(:8787)
setlocal
cd /d "%~dp0"

set "PY=.venv\Scripts\python.exe"

if not exist "%PY%" (
  echo [songlearn-align] 创建虚拟环境 .venv ...
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo [songlearn-align] 找不到 Python 3.11，请先安装：https://www.python.org/downloads/
    pause
    exit /b 1
  )
)

"%PY%" -c "import flask, faster_whisper, scipy" 1>nul 2>nul
if errorlevel 1 (
  echo [songlearn-align] 安装依赖（首次约 3-5 分钟）...
  "%PY%" -m pip install --disable-pip-version-check -r requirements.txt
  if errorlevel 1 (
    echo [songlearn-align] 依赖安装失败
    pause
    exit /b 1
  )
)

rem 歌词含西语/CJK，Windows 控制台默认 GBK 会 UnicodeEncodeError
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo [songlearn-align] 启动中… 浏览器端会自动探测 http://127.0.0.1:8787/api/health
"%PY%" -m app --port 8787
pause
