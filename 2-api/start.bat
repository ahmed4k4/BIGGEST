@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .env ( copy .env.example .env >nul & echo تم إنشاء .env — عدّله ثم أعد التشغيل & notepad .env & pause & exit /b )
node scripts\dev.mjs
pause
