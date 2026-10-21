#!/bin/bash
# 阅历书房 · 启动服务（服务没跑起来时双击）
set -u
DEST="$HOME/.reading-room"
LA="$HOME/Library/LaunchAgents"

if curl -s -m 2 http://127.0.0.1:8765/api/state >/dev/null 2>&1; then
  echo "✓ 服务已经在跑了"
else
  echo "→ 正在启动服务…"
  launchctl load "$LA/com.acha.readingroom.server.plist" 2>/dev/null \
    || nohup python3 "$DEST/server.py" >"$DEST/logs/server.log" 2>&1 &
  sleep 2
fi
open "http://127.0.0.1:8765" 2>/dev/null
echo "✓ 书房已打开：http://127.0.0.1:8765"
