@echo off
cd /d "%~dp0..\backend"
echo Stopping anything on port 8001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001" ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo Starting app...
call .venv\Scripts\activate.bat
uvicorn main:app --reload --host 127.0.0.1 --port 8001
pause
