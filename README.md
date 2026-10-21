# 阅历书房 · Mac 版

把你在 **图书 App（epub）** 和 **预览（PDF）** 里划过的线，变成桌面上一张会轮播的卡片；
看到有感的句子，随手记一笔，自动关联到这条划线；
再加一个精美的「书房」总览页：图片轮播、书架、划线热力图、随笔时间线。

数据全在你 Mac 本地（`~/.reading-room/data/`，JSON 明文），不经过任何云端。

## 从 GitHub 获取与更新

代码托管在 GitHub 公开仓库：https://github.com/acha19191919/reading-room
（仓库只含代码，不含你的任何数据；你的划线/随笔都在本机 `~/.reading-room/data/`。
仓库也不含 `web/assets/` 的氛围图——图片随安装包分发，自动更新不会覆盖你已有的图。）

- **第一次**：下载安装包解压，双击「安装.command」。它会顺带把仓库克隆到 `~/.reading-room-src` 并注册自动更新任务。
- **以后更新全自动**：每天 21:30 自动检查新版，有更新就拉取、覆盖程序文件、重启服务，你什么都不用做；更新记录在 `~/.reading-room/logs/update.log`。
- **想立刻更新**：双击「更新.command」。
- 若桌面卡片还显示旧版本号，在 Übersicht 菜单里点 Refresh All Widgets 即可（卡片底部也会有提示）。

手动用 git 的话：`git clone https://github.com/acha19191919/reading-room.git`，更新后重跑一次「安装.command」。

你的划线、随笔、设置都存在 `~/.reading-room/data/`，更新代码不会丢。

## 安装（3 步）

1. **先装 Übersicht**（免费桌面组件工具）：https://tracesof.net/uebersicht/
2. 下载 `阅历书房-mac.zip`，解压，**双击「安装.command」**
   - macOS 可能会弹「无法验证开发者」：右键点击「安装.command」→「打开」→「打开」，即可运行
   - 安装脚本会自动：装依赖 → 拷文件 → 装桌面组件 → 注册开机自启 → 跑一次采集 → 打开书房页
3. 打开 Übersicht，点一下菜单里的「yueli」组件，卡片就出现在桌面右下角（可拖动换位置）

## 日常使用

| 动作 | 做法 |
|---|---|
| 看轮播 | 桌面右下角卡片，默认 2 分钟换一条 |
| 切换上一条 / 下一条 | 点卡片上的按钮；或先点一下卡片，再按键盘 **← / →**（在随笔框里打字时不触发） |
| 删掉不喜欢的划线 | 卡片上「删除」按钮，点两次确认；删了采集也不会再捡回来 |
| 回原书定位 | 卡片底部「回原书 ↗」或书房页里划线旁的「回原书」：图书 App 的书会自动打开并搜原文跳到那句（首次使用需在 系统设置 → 隐私与安全性 → 辅助功能 里打开「python3」）；PDF 只打开文件 |
| 复制书摘 | 书房页里每条划线 / 随笔旁的「复制」，复制为 Markdown 引用格式 |
| 写随笔 | 卡片下方的输入框写完点「记一笔」，自动关联当前这条划线 |
| 改轮播间隔 / 随笔是否参与轮播 / 随机或顺序 | 打开书房页 http://127.0.0.1:8765 ，右下角 ⚙ 设置 |
| 同步新划线 | 每天 22:00 自动跑；或双击「同步划线.command」立刻同步 |
| 打开书房总览页 | 双击「启动书房.command」，或浏览器打开 http://127.0.0.1:8765 |
| 给书标状态（在读/读完/计划读/暂停） | 书房页 → 书架 → 点一本书 → 右上角下拉框 |

## 文件说明

```
~/.reading-room/
  collect.py / server.py      程序本体
  web/                        书房总览页（含 assets/ 首页图片）
  data/
    books.json                书目（书是主键）
    highlights.json           划线
    thoughts.json             随笔（自动关联到划线）
    settings.json             设置（轮播间隔/随笔参与/随机或顺序/PDF目录）
  logs/                       运行日志
```

- 往 `web/assets/` 里放 `hero6.jpg、hero7.jpg…`，会自动加入首页图片轮播
- PDF 书统一放在 `~/Documents/书`（子文件夹也行）；换地方的话改 `data/settings.json` 里的 `pdf_dir`

## 常见问题

- **桌面组件显示"服务还没启动"**：双击「启动书房.command」
- **图书 App 的划线没进来**：确认是在 Mac 的图书 App 里划的（不是 iPhone/iPad 且没同步到 Mac）；采集日志看 `~/.reading-room/logs/collect.log`
- **PDF 划线没进来**：确认是用预览的「高亮文本」画的（手写涂鸦取不到）；确认 PDF 在 `~/Documents/书` 里
- **组件想换位置**：在 Übersicht 里直接拖（或改组件设置）
- **卸载**：`launchctl unload ~/Library/LaunchAgents/com.acha.readingroom.*.plist`，删掉 `~/.reading-room/` 和 Übersicht 里的组件即可

## 二期（预留）

- Kindle `My Clippings.txt` 接入（`collect.py` 里 `collect_kindle()` 已留接口）
- 阅读计时（开始/结束按钮 → 阅读时长 → 热力图从"划线活跃度"升级为"阅读时长"）
- 安卓端（Tasker + KWGT / Flutter）
