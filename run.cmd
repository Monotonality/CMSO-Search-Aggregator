@echo off
REM Double-click or run from CMD: starts CMSO Signal (venv, index, server, browser).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
