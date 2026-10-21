#!/bin/bash
# 阅历书房 · 自动更新（由 launchd 每天 21:30 触发，也可手动跑）
# 逻辑：git 拉取代码仓库 → 有新提交才继续 → 覆盖程序文件 → 重启本地服务 → 补跑一次采集
# 全程不碰 ~/.reading-room/data/（划线、随笔、设置都在那里，更新不动数据）
set -u
export GIT_TERMINAL_PROMPT=0
SRC="$HOME/.reading-room-src"
DEST="$HOME/.reading-room"
LOG="$DEST/logs/update.log"
mkdir -p "$DEST/logs"
ts() { date "+%Y-%m-%d %H:%M:%S"; }

[ -d "$SRC/.git" ] || { echo "[$(ts)] 没有代码仓库（$SRC），跳过" >> "$LOG"; exit 0; }
cd "$SRC" || exit 0

git fetch --quiet origin >> "$LOG" 2>&1 || { echo "[$(ts)] fetch 失败（没网？），下次再试" >> "$LOG"; exit 0; }
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse '@{u}' 2>/dev/null || git rev-parse origin/HEAD 2>/dev/null)
[ -n "$REMOTE" ] || { echo "[$(ts)] 取不到远端版本，跳过" >> "$LOG"; exit 0; }
[ "$LOCAL" != "$REMOTE" ] || exit 0   # 已是最新，悄悄退出

git pull --ff-only --quiet >> "$LOG" 2>&1 || { echo "[$(ts)] pull 失败（本地有改动？），跳过本次更新" >> "$LOG"; exit 0; }
echo "[$(ts)] 发现新版：$LOCAL -> $REMOTE，开始更新" >> "$LOG"

# 覆盖程序文件（web 用合并拷贝：仓库不含 web/assets 的图片二进制，
# 合并拷贝不会删掉用户已有的氛围图）
cp -f "$SRC/collect.py" "$SRC/server.py" "$DEST/"
mkdir -p "$DEST/web"
cp -R "$SRC/web/." "$DEST/web/"
UWIDGET_DIR="$HOME/Library/Application Support/Übersicht/widgets"
if [ -d "$HOME/Library/Application Support/Übersicht" ]; then
  mkdir -p "$UWIDGET_DIR"
  rm -rf "$UWIDGET_DIR/yueli.widget"
  cp -R "$SRC/widget/yueli.widget" "$UWIDGET_DIR/yueli.widget"
fi

# 重启本地服务，让新代码生效
LA="$HOME/Library/LaunchAgents"
launchctl unload "$LA/com.acha.readingroom.server.plist" 2>/dev/null
launchctl load "$LA/com.acha.readingroom.server.plist" 2>/dev/null

# 补跑一次采集（新版可能新增采集字段，比如章节/定位）
python3 "$DEST/collect.py" >> "$LOG" 2>&1

# 最后才更新自己（避免脚本跑到一半被自己覆盖）
cp -f "$SRC/self-update.sh" "$DEST/self-update.sh" 2>/dev/null
echo "[$(ts)] 更新完成" >> "$LOG"
