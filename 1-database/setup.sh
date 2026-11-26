#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
echo "عدّل ملف .env (DATABASE_URL) ثم أعد تشغيل هذا الملف لو لم يكن مضبوطًا"
node scripts/migrate.mjs --seed
