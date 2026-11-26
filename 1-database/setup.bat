@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
echo عدّل ملف .env (DATABASE_URL) ثم اضغط أي زر للمتابعة...
notepad .env
pause
node scripts\migrate.mjs --seed
pause
