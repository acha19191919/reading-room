#!/bin/bash
# 阅历书房 · 一键安装（双击运行）
# 做的事情：
#  1. 检查 python3，安装 pymupdf
#  2. 把程序拷到 ~/.reading-room/
#  3. 把桌面组件装进 Übersicht
#  4. 注册开机自启动（本地服务 + 每天 22:00 自动采集）
#  5. 启动服务、跑一次采集、打开书房总览页
set -u
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.reading-room"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  阅历书房 · 正在安装"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. python3
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 没找到 python3，请先去 App Store 安装 Xcode Command Line Tools 后再试。"
  echo "   安装命令：xcode-select --install"
  read -p "按回车退出…"
  exit 1
fi
echo "✓ python3: $(python3 --version)"

# 2. pymupdf（PDF 划线提取用）
if python3 -c "import fitz" 2>/dev/null; then
  echo "✓ pymupdf 已安装"
else
  echo "→ 正在安装 pymupdf（只需一次）…"
  python3 -m pip install --user pymupdf 2>/dev/null \
    || python3 -m pip install --user --break-system-packages pymupdf
  if python3 -c "import fitz" 2>/dev/null; then
    echo "✓ pymupdf 安装成功"
  else
    echo "⚠️  pymupdf 安装失败，PDF 采集会跳过，图书 App 划线不受影响。"
  fi
fi

# 3. 拷文件
mkdir -p "$DEST"
cp -f "$SRC/collect.py" "$SRC/server.py" "$DEST/"
rm -rf "$DEST/web"
cp -R "$SRC/web" "$DEST/web"
mkdir -p "$DEST/data" "$DEST/logs"
echo "✓ 程序已放到 $DEST"

# 4. Übersicht 组件
UWIDGET_DIR="$HOME/Library/Application Support/Übersicht/widgets"
if [ -d "$HOME/Library/Application Support/Übersicht" ]; then
  mkdir -p "$UWIDGET_DIR"
  rm -rf "$UWIDGET_DIR/yueli.widget" "$UWIDGET_DIR/阅历轮播.widget"
  cp -R "$SRC/widget/yueli.widget" "$UWIDGET_DIR/yueli.widget"
  echo "✓ 桌面组件已安装（Übersicht 菜单里点一下 yueli 即可显示）"
else
  echo "⚠️  没检测到 Übersicht，请先去 https://tracesof.net/uebersicht/ 安装（免费），"
  echo "   装好后再双击一次本安装脚本，组件会自动装上。"
fi

# 5. launchd：开机自启服务 + 每天 22:00 采集
LA="$HOME/Library/LaunchAgents"
mkdir -p "$LA"
sed "s|__HOME__|$HOME|g" "$SRC/launchd/com.acha.readingroom.server.plist" > "$LA/com.acha.readingroom.server.plist"
sed "s|__HOME__|$HOME|g" "$SRC/launchd/com.acha.readingroom.collect.plist" > "$LA/com.acha.readingroom.collect.plist"
launchctl unload "$LA/com.acha.readingroom.server.plist" 2>/dev/null
launchctl unload "$LA/com.acha.readingroom.collect.plist" 2>/dev/null
launchctl load "$LA/com.acha.readingroom.server.plist"
launchctl load "$LA/com.acha.readingroom.collect.plist"
echo "✓ 开机自启已注册（服务常驻 + 每天 22:00 自动采集）"

# 5.5 自动更新：克隆代码仓库 + 注册每天 21:30 的更新任务
REPO_URL="https://github.com/acha19191919/reading-room.git"
SRC_DIR="$HOME/.reading-room-src"
if command -v git >/dev/null 2>&1; then
  if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" pull --ff-only -q 2>/dev/null || true
    echo "✓ 代码仓库已同步（$SRC_DIR）"
  elif git clone -q "$REPO_URL" "$SRC_DIR" 2>/dev/null; then
    echo "✓ 代码仓库已克隆（$SRC_DIR）"
  else
    echo "⚠️ 仓库克隆失败（可能没网），自动更新暂未启用；联网后重跑一次安装即可"
  fi
  cp -f "$SRC/self-update.sh" "$DEST/"
  sed "s|__HOME__|$HOME|g" "$SRC/launchd/com.acha.readingroom.update.plist" > "$LA/com.acha.readingroom.update.plist"
  launchctl unload "$LA/com.acha.readingroom.update.plist" 2>/dev/null
  launchctl load "$LA/com.acha.readingroom.update.plist"
  echo "✓ 自动更新已注册（每天 21:30 检查新版；也可双击「更新.command」立即更新）"
else
  echo "⚠️ 没找到 git，自动更新未启用（装好 Xcode Command Line Tools 后重跑一次安装）"
fi

# 6. 首次采集
echo "→ 首次采集划线（图书 App + PDF）…"
python3 "$DEST/collect.py"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 安装完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "· 书房总览页：http://127.0.0.1:8765（已在浏览器打开）"
echo "· 桌面组件：打开 Übersicht，点一下「阅历轮播」"
echo "· 手动同步划线：双击「同步划线.command」"
echo "· 以后往 ~/Documents/书 里放 PDF、划完线，"
echo "  每天 22:00 会自动收录，或随时手动同步。"
open "http://127.0.0.1:8765" 2>/dev/null
read -p "按回车关闭…"
