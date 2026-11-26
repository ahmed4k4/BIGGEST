@echo off
chcp 65001 >nul
rem ينشئ اختصارًا في مجلد Startup ليعمل الكاشير تلقائيًا عند فتح الجهاز
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\BIGGEST POS.lnk'); $s.TargetPath='%~dp0start-pos.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo تم. سيعمل الكاشير تلقائيًا عند تشغيل الجهاز.
pause
