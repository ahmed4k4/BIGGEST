#!/usr/bin/env bash
cd "$(dirname "$0")"
node src/headless.js &
sleep 3
(command -v chromium >/dev/null && chromium --app=http://127.0.0.1:7070) || (command -v google-chrome >/dev/null && google-chrome --app=http://127.0.0.1:7070) || xdg-open http://127.0.0.1:7070
wait
