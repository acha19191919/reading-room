#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
阅历 · 本地服务 server.py
跑在 Mac 本地（127.0.0.1:8765），只用标准库：
  - 托管「书房」总览页（web/）
  - 给桌面组件和总览页提供数据接口
  - 接收随手记（POST /api/thought）
  - 读写设置（轮播间隔 / 随笔是否参与轮播 / 随机或顺序）

接口：
  GET  /api/state     {books, highlights, thoughts, settings}
  GET  /api/queue     按当前设置排好的轮播卡片序列
  POST /api/thought   {highlight_id, text} -> 记一笔随笔
  POST /api/settings  {carousel_interval_sec?, thoughts_in_carousel?, carousel_mode?}
  POST /api/book      {id, status} -> 设置书的状态 reading|finished|planned|paused
  POST /api/delete    {kind, id} -> 删除划线/随笔（kind: highlight|thought；
                        删划线会记入删除名单，下次采集不再捡回；随笔不受影响）
  POST /api/open-source {kind, id} -> 回原书：图书 App 的书打开后自动搜原文定位；
                        PDF 则用预览打开文件

用法：python3 server.py [port]
"""
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, ".reading-room")
DATA = os.path.join(BASE, "data")
WEB_DIR = os.path.join(BASE, "web")

VERSION = "1.6.1"

BOOKS_JSON = os.path.join(DATA, "books.json")
HIGHLIGHTS_JSON = os.path.join(DATA, "highlights.json")
THOUGHTS_JSON = os.path.join(DATA, "thoughts.json")
SETTINGS_JSON = os.path.join(DATA, "settings.json")
DELETED_JSON = os.path.join(DATA, "deleted.json")  # 用户删掉的划线 id 名单，采集时跳过

DEFAULT_SETTINGS = {
    "carousel_interval_sec": 120,
    "thoughts_in_carousel": True,
    "carousel_mode": "random",
    "pdf_dir": os.path.expanduser("~/Documents/书"),
}


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def get_settings():
    s = dict(DEFAULT_SETTINGS)
    s.update(load_json(SETTINGS_JSON, {}))
    # 钳制
    try:
        s["carousel_interval_sec"] = max(5, min(3600, int(s["carousel_interval_sec"])))
    except Exception:
        s["carousel_interval_sec"] = 120
    if s["carousel_mode"] not in ("random", "sequential"):
        s["carousel_mode"] = "random"
    s["thoughts_in_carousel"] = bool(s["thoughts_in_carousel"])
    return s


def build_queue():
    """按设置生成轮播卡片序列。随笔参与轮播时，跟在它关联的划线后面。"""
    settings = get_settings()
    highlights = load_json(HIGHLIGHTS_JSON, [])
    thoughts = load_json(THOUGHTS_JSON, [])

    thoughts_by_hl = {}
    for t in thoughts:
        thoughts_by_hl.setdefault(t.get("highlight_id"), []).append(t)

    items = list(highlights)
    if settings["carousel_mode"] == "random":
        random.shuffle(items)
    else:
        items.sort(key=lambda h: h.get("created_at") or "", reverse=True)

    queue = []
    for h in items:
        queue.append({"kind": "highlight", **h})
        if settings["thoughts_in_carousel"]:
            for t in sorted(thoughts_by_hl.get(h["id"], []),
                            key=lambda x: x.get("created_at") or ""):
                queue.append({"kind": "thought", **t})
    if settings["thoughts_in_carousel"]:
        # 划线被删掉后，它的随笔成了"孤儿"——别让用户自己的字悄悄消失，排在最后
        seen_hl = {h.get("id") for h in highlights}
        orphans = sorted(
            (t for t in thoughts if t.get("highlight_id") not in seen_hl),
            key=lambda x: x.get("created_at") or "",
        )
        for t in orphans:
            queue.append({"kind": "thought", **t})
    return {"queue": queue, "settings": settings, "version": VERSION}


def _applescript_str(s):
    """把字符串转成 AppleScript 字符串字面量（转义反斜杠/引号，换行变空格）。"""
    s = (s or "").replace("\\", "\\\\").replace('"', '\\"')
    s = s.replace("\r", " ").replace("\n", " ")
    return '"' + s + '"'


def _search_snippet(text):
    """回原书搜索词：划线原文的第一行前 36 字（够独特，又不会长到搜不中）。"""
    line = (text or "").strip().split("\n")[0].strip()
    return line[:36]


def open_in_books(asset_id, search_text):
    """土方法回原书精准定位：ibooks:// 打开书 → ⌘F → 粘贴原文 → 回车，
    图书 App 会自己跳到那句并高亮。返回 (ok, error_msg)。
    需要「辅助功能」权限（系统设置 → 隐私与安全性 → 辅助功能 → python3）。"""
    script = f"""
set assetId to {_applescript_str(asset_id)}
set searchText to {_applescript_str(search_text)}
set opened to false
try
  open location "ibooks://assetid/" & assetId
  set opened to true
end try
if not opened then
  try
    open location "books://assetid/" & assetId
    set opened to true
  end try
end if
if not opened then error "图书 App 打不开这本书"
delay 2.5
tell application "Books" to activate
delay 0.6
set hasClip to true
try
  set oldClip to the clipboard
on error
  set hasClip to false
end try
set the clipboard to searchText
tell application "System Events"
  tell process "Books"
    keystroke "f" using command down
    delay 0.5
    keystroke "v" using command down
    delay 0.4
    keystroke return
  end tell
end tell
delay 0.6
if hasClip then set the clipboard to oldClip
"""
    try:
        proc = subprocess.run(["/usr/bin/osascript", "-e", script],
                              capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        return False, "这台电脑上没有 osascript"
    except subprocess.TimeoutExpired:
        return False, "跳转超时，图书 App 可能还没打开完"
    if proc.returncode != 0:
        err = (proc.stderr or "").strip()
        if "1743" in err or "not allowed" in err.lower() or "不允许" in err:
            return False, ("需要授权：系统设置 → 隐私与安全性 → 辅助功能，"
                           "把「python3」打开后重试")
        return False, "跳转失败：" + (err[:120] or "未知错误")
    return True, ""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, *args):
        pass  # 安静

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            self._send_json({
                "books": load_json(BOOKS_JSON, []),
                "highlights": load_json(HIGHLIGHTS_JSON, []),
                "thoughts": load_json(THOUGHTS_JSON, []),
                "settings": get_settings(),
                "version": VERSION,
            })
        elif path == "/api/queue":
            self._send_json(build_queue())
        elif path in ("/api/settings",):
            self._send_json(get_settings())
        else:
            if path == "/":
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_body()
        if path == "/api/thought":
            highlight_id = (body.get("highlight_id") or "").strip()
            text = (body.get("text") or "").strip()
            if not text:
                return self._send_json({"ok": False, "error": "内容为空"}, 400)
            highlights = {h["id"]: h for h in load_json(HIGHLIGHTS_JSON, [])}
            h = highlights.get(highlight_id, {})
            thought = {
                "id": "th_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f"),
                "highlight_id": highlight_id,
                "book_id": h.get("book_id", ""),
                "book_title": h.get("book_title", ""),
                "quote": (h.get("text") or "")[:120],
                "text": text,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            thoughts = load_json(THOUGHTS_JSON, [])
            thoughts.append(thought)
            save_json(THOUGHTS_JSON, thoughts)
            return self._send_json({"ok": True, "thought": thought})
        elif path == "/api/settings":
            settings = get_settings()
            for k in ("carousel_interval_sec", "thoughts_in_carousel", "carousel_mode"):
                if k in body:
                    settings[k] = body[k]
            # 合并回默认值并做一次钳制校验
            clean = dict(DEFAULT_SETTINGS)
            clean.update(settings)
            save_json(SETTINGS_JSON, clean)
            return self._send_json({"ok": True, "settings": get_settings()})
        elif path == "/api/book":
            book_id = (body.get("id") or "").strip()
            status = (body.get("status") or "").strip()
            if status not in ("reading", "finished", "planned", "paused"):
                return self._send_json({"ok": False, "error": "状态不合法"}, 400)
            books = load_json(BOOKS_JSON, [])
            for b in books:
                if b["id"] == book_id:
                    b["status"] = status
            save_json(BOOKS_JSON, books)
            return self._send_json({"ok": True})
        elif path == "/api/delete":
            kind = (body.get("kind") or "").strip()
            item_id = (body.get("id") or "").strip()
            if kind == "highlight" and item_id:
                highlights = [h for h in load_json(HIGHLIGHTS_JSON, [])
                              if h.get("id") != item_id]
                save_json(HIGHLIGHTS_JSON, highlights)
                deleted = load_json(DELETED_JSON, [])
                if item_id not in deleted:
                    deleted.append(item_id)
                save_json(DELETED_JSON, deleted)
                return self._send_json({"ok": True})
            elif kind == "thought" and item_id:
                thoughts = [t for t in load_json(THOUGHTS_JSON, [])
                            if t.get("id") != item_id]
                save_json(THOUGHTS_JSON, thoughts)
                return self._send_json({"ok": True})
            return self._send_json({"ok": False, "error": "参数不合法"}, 400)
        elif path == "/api/open-source":
            kind = (body.get("kind") or "").strip()
            item_id = (body.get("id") or "").strip()
            highlights = load_json(HIGHLIGHTS_JSON, [])
            hl = None
            if kind == "highlight":
                hl = next((h for h in highlights if h.get("id") == item_id), None)
            elif kind == "thought":
                th = next((t for t in load_json(THOUGHTS_JSON, [])
                           if t.get("id") == item_id), None)
                if th:
                    hl = next((h for h in highlights
                               if h.get("id") == th.get("highlight_id")), None)
                    if not hl:
                        # 划线已删（孤儿随笔）：用随笔里存的引文与书号兜底
                        tb = th.get("book_id") or ""
                        hl = {"book_id": tb, "text": th.get("quote") or "",
                              "source": "applebooks" if tb.startswith("applebooks:") else ""}
            if not hl:
                return self._send_json({"ok": False, "error": "找不到这条记录"}, 404)
            book_id = hl.get("book_id") or ""
            if book_id.startswith("applebooks:"):
                asset = book_id.split(":", 1)[1]
                if not asset:
                    return self._send_json({"ok": False, "error": "这本书缺 asset id"}, 400)
                ok, err = open_in_books(asset, _search_snippet(hl.get("text")))
                if ok:
                    return self._send_json({"ok": True, "mode": "search"})
                return self._send_json({"ok": False, "error": err})
            if book_id.startswith("pdf:"):
                book = next((b for b in load_json(BOOKS_JSON, [])
                             if b.get("id") == book_id), None)
                fpath = (book or {}).get("path") or ""
                if fpath and os.path.exists(fpath):
                    try:
                        proc = subprocess.run(["open", "-a", "Preview", fpath],
                                              capture_output=True, text=True, timeout=10)
                        if proc.returncode == 0:
                            return self._send_json({"ok": True, "mode": "file"})
                        return self._send_json(
                            {"ok": False, "error": "预览打不开这个 PDF：" +
                             (proc.stderr or "").strip()[:100]})
                    except Exception as e:
                        return self._send_json(
                            {"ok": False, "error": f"打开 PDF 失败：{e}"})
                return self._send_json(
                    {"ok": False, "error": "找不到这个 PDF 文件了（可能被移动或改名）"}, 404)
            return self._send_json(
                {"ok": False, "error": "这条记录的来源不支持回原书"}, 400)
        return self._send_json({"ok": False, "error": "未知接口"}, 404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(WEB_DIR, exist_ok=True)
    if not os.path.exists(SETTINGS_JSON):
        save_json(SETTINGS_JSON, DEFAULT_SETTINGS)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"阅历书房服务已启动：http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
