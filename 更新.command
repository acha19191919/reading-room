#!/bin/bash
# 阅历书房 · 立即检查更新（平时每天 21:30 自动跑，这里是手动触发）
bash "$HOME/.reading-room/self-update.sh"
echo "—— 最近的更新记录 ——"
tail -5 "$HOME/.reading-room/logs/update.log" 2>/dev/null || echo "（还没有更新记录）"
echo ""
echo "提示：若桌面卡片还显示旧版本号，在 Übersicht 菜单里点一下 Refresh All Widgets 即可。"
read -p "按回车关闭…"
