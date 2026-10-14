#!/bin/zsh
cd "$(dirname "$0")" || exit 1
echo 'Blue Hour v6 — open http://localhost:8000 in your browser'
python3 -m http.server 8000
