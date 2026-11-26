@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "BIGGEST POS" /min node src\headless.js
timeout /t 3 >nul
where chrome >nul 2>nul && ( start "" chrome --app=http://127.0.0.1:7070 ) || ( start "" http://127.0.0.1:7070 )
