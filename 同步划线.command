#!/bin/bash
# 阅历书房 · 手动同步划线（双击运行）
set -u
python3 "$HOME/.reading-room/collect.py"
echo ""
echo "✓ 同步完成。桌面组件点一下 ↻ 按钮即可看到新划线。"
read -p "按回车关闭…"
