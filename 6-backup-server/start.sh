#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "عدّل .env ثم أعد التشغيل"; exit 1; }
node src/index.js run
