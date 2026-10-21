#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
阅历 · 采集脚本 collect.py
把 Mac 上三处读书划线收进统一的 JSON：
  1. 图书 App（epub）：直读本地标注库 AEAnnotation_*.sqlite
  2. 预览（PDF）：扫描固定文件夹，用 pymupdf 提取高亮/下划线标注
  3. Kindle：二期接入（My Clippings.txt），接口已预留

输出到 ~/.reading-room/data/：
  books.json      书目（书是主键，一切挂在书上）
  highlights.json 划线
  thoughts.json   随笔（只创建不改动）
  settings.json   设置（只创建不改动）

幂等：重复运行不会产生重复条目（按稳定 id 去重）。
用法：python3 collect.py
"""
import glob
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, ".reading-room")
DATA = os.path.join(BASE, "data")
LOG_DIR = os.path.join(BASE, "logs")

BOOKS_JSON = os.path.join(DATA, "books.json")
HIGHLIGHTS_JSON = os.path.join(DATA, "highlights.json")
THOUGHTS_JSON = os.path.join(DATA, "thoughts.json")
SETTINGS_JSON = os.path.join(DATA, "settings.json")
DELETED_JSON = os.path.join(DATA, "deleted.json")  # 用户删掉的划线 id，跳过不再采集

# CoreData 时间戳：距离 2001-01-01 的秒数
COREDATA_EPOCH = 978307200

DEFAULT_SETTINGS = {
    "carousel_interval_sec": 120,   # 轮播间隔（秒），默认 2 分钟
    "thoughts_in_carousel": True,   # 随笔是否参与轮播
    "carousel_mode": "random",      # random | sequential
    "pdf_dir": os.path.expanduser("~/Documents/书"),
}


def log(msg):
    os.makedirs(LOG_DIR, exist_ok=True)
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(os.path.join(LOG_DIR, "collect.log"), "a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log(f"读取 {path} 失败（{e}），使用默认值")
    return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def stable_id(*parts):
    h = hashlib.sha256("||".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return h[:16]


def coredata_to_iso(ts):
    try:
        return datetime.fromtimestamp(float(ts) + COREDATA_EPOCH, tz=timezone.utc).isoformat()
    except Exception:
        return None


# ---------------- 图书 App（epub 划线） ----------------

def find_books_annotation_db():
    cands = glob.glob(os.path.join(
        HOME, "Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/AEAnnotation*.sqlite"))
    # 排除 -wal / -shm
    cands = [c for c in cands if not c.endswith(("-wal", "-shm", "-journal"))]
    return sorted(cands)


def find_books_library_db():
    cands = glob.glob(os.path.join(
        HOME, "Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/BKLibrary*.sqlite"))
    cands = [c for c in cands if not c.endswith(("-wal", "-shm", "-journal"))]
    return sorted(cands)


def copy_db_safe(src):
    """图书 App 可能正在运行，先拷一份再读，避免锁库。"""
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    shutil.copy2(src, tmp)
    for suffix in ("-wal", "-shm"):
        if os.path.exists(src + suffix):
            try:
                shutil.copy2(src + suffix, tmp + suffix)
            except Exception:
                pass
    return tmp


def table_columns(conn, table):
    rows = conn.execute(f"PRAGMA table_info([{table}])").fetchall()
    return [r[1] for r in rows]


def collect_apple_books():
    """返回 (books, highlights)，books: {asset_id: {title, author}}"""
    books, highlights = {}, []
    dbs = find_books_annotation_db()
    if not dbs:
        log("未找到图书 App 标注库（可能没用过图书 App 划线），跳过")
        return books, highlights

    # 书名映射：asset_id -> (title, author)
    title_map = {}
    for lib in find_books_library_db():
        tmp = copy_db_safe(lib)
        try:
            conn = sqlite3.connect(tmp)
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")]
            asset_table = next((t for t in tables if "ASSET" in t.upper()), None)
            if asset_table:
                cols = table_columns(conn, asset_table)
                id_col = next((c for c in cols if "ASSETID" in c.upper()), None)
                title_col = next((c for c in cols if "TITLE" in c.upper()), None)
                author_col = next((c for c in cols if "AUTHOR" in c.upper()), None)
                if id_col and title_col:
                    q = f"SELECT [{id_col}], [{title_col}]" + (f", [{author_col}]" if author_col else "") + f" FROM [{asset_table}]"
                    for row in conn.execute(q):
                        title_map[str(row[0])] = (row[1], row[2] if len(row) > 2 else "")
            conn.close()
        except Exception as e:
            log(f"读取书库 {lib} 失败：{e}")
        finally:
            for s in (tmp, tmp + "-wal", tmp + "-shm"):
                if os.path.exists(s):
                    os.remove(s)

    for db in dbs:
        tmp = copy_db_safe(db)
        try:
            conn = sqlite3.connect(tmp)
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")]
            ann_table = next((t for t in tables if "ANNOTATION" in t.upper()), None)
            if not ann_table:
                log(f"{db} 里没找到标注表，跳过")
                conn.close()
                continue
            cols = table_columns(conn, ann_table)
            upper = {c.upper(): c for c in cols}

            def pick(*names):
                for n in names:
                    if n in upper:
                        return upper[n]
                return None

            c_asset = pick("ZANNOTATIONASSETID")
            c_text = pick("ZANNOTATIONSELECTEDTEXT")
            c_note = pick("ZANNOTATIONNOTE")
            c_created = pick("ZANNOTATIONCREATIONDATE")
            c_deleted = pick("ZANNOTATIONDELETED")
            c_style = pick("ZANNOTATIONSTYLE")
            c_chapter = pick("ZFUTUREPROOFING5")          # 章节名（显示用）
            c_loc = pick("ZANNOTATIONLOCATION")           # 书内精确定位串（回原书跳转用）
            c_locstart = pick("ZPLLOCATIONRANGESTART")    # 位置序号（同书内按阅读顺序排序用）
            if not (c_asset and c_text):
                log(f"{ann_table} 缺少关键列 {cols}，跳过")
                conn.close()
                continue

            sel = [c_asset, c_text]
            if c_note: sel.append(c_note)
            if c_created: sel.append(c_created)
            if c_deleted: sel.append(c_deleted)
            if c_style: sel.append(c_style)
            if c_chapter: sel.append(c_chapter)
            if c_loc: sel.append(c_loc)
            if c_locstart: sel.append(c_locstart)
            q = f"SELECT {', '.join('[' + c + ']' for c in sel)} FROM [{ann_table}]"
            n = 0
            for row in conn.execute(q):
                vals = dict(zip(sel, row))
                if c_deleted and vals.get(c_deleted):
                    continue
                text = (vals.get(c_text) or "").strip()
                if not text:
                    continue
                asset_id = str(vals.get(c_asset) or "")
                title, author = title_map.get(asset_id, ("未知书名", ""))
                book_id = "applebooks:" + (asset_id or stable_id(title))
                books[book_id] = {"id": book_id, "title": title or "未知书名",
                                  "author": author or "", "source": "applebooks"}
                hid = "hl_" + stable_id("applebooks", book_id, text)
                chapter = (str(vals.get(c_chapter) or "").strip() if c_chapter else "")
                locator = (str(vals.get(c_loc) or "").strip() if c_loc else "")
                loc_start = vals.get(c_locstart) if c_locstart else None
                highlights.append({
                    "id": hid,
                    "book_id": book_id,
                    "book_title": books[book_id]["title"],
                    "author": books[book_id]["author"],
                    "text": text,
                    "note": (vals.get(c_note) or "").strip() if c_note else "",
                    "location": chapter,
                    "locator": locator,
                    "loc_start": loc_start if isinstance(loc_start, (int, float)) else None,
                    "created_at": coredata_to_iso(vals.get(c_created)) if c_created else None,
                    "source": "applebooks",
                })
                n += 1
            log(f"图书 App：{os.path.basename(db)} 取到 {n} 条划线")
            conn.close()
        except Exception as e:
            log(f"读取标注库 {db} 失败：{e}")
        finally:
            for s in (tmp, tmp + "-wal", tmp + "-shm"):
                if os.path.exists(s):
                    os.remove(s)
    return books, highlights


# ---------------- PDF 扫描 ----------------

def collect_pdfs(pdf_dir):
    books, highlights = {}, []
    if not os.path.isdir(pdf_dir):
        log(f"PDF 文件夹不存在：{pdf_dir}，跳过")
        return books, highlights
    try:
        import fitz  # pymupdf
    except ImportError:
        log("缺少 pymupdf，PDF 跳过。请运行：python3 -m pip install pymupdf")
        return books, highlights

    pdfs = sorted(glob.glob(os.path.join(pdf_dir, "**", "*.pdf"), recursive=True))
    log(f"PDF 文件夹 {pdf_dir}：找到 {len(pdfs)} 个 PDF")
    for pdf in pdfs:
        try:
            doc = fitz.open(pdf)
        except Exception as e:
            log(f"打不开 {os.path.basename(pdf)}：{e}")
            continue
        title = os.path.splitext(os.path.basename(pdf))[0]
        book_id = "pdf:" + stable_id(pdf)
        books[book_id] = {"id": book_id, "title": title, "author": "",
                          "source": "pdf", "path": pdf}
        # 元信息里有作者就拿
        try:
            meta_author = (doc.metadata or {}).get("author", "").strip()
            if meta_author:
                books[book_id]["author"] = meta_author
        except Exception:
            pass
        count = 0
        for pno, page in enumerate(doc):
            try:
                annots = list(page.annots() or [])
            except Exception:
                continue
            words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,word_no
            for annot in annots:
                try:
                    atype = annot.type[1] if isinstance(annot.type, (list, tuple)) else str(annot.type)
                except Exception:
                    atype = ""
                if atype not in ("Highlight", "Underline", "Squiggly", "StrikeOut"):
                    continue
                rect = annot.rect
                texts = [w[4] for w in words
                         if fitz.Rect(w[:4]).intersects(rect)]
                text = " ".join(texts).strip()
                if not text:
                    # 退化：直接取标注框内文本
                    try:
                        text = page.get_textbox(rect).strip().replace("\n", " ")
                    except Exception:
                        text = ""
                if not text:
                    continue
                hid = "hl_" + stable_id("pdf", book_id, text, pno)
                highlights.append({
                    "id": hid,
                    "book_id": book_id,
                    "book_title": title,
                    "author": books[book_id]["author"],
                    "text": text,
                    "note": "",
                    "location": f"第 {pno + 1} 页",
                    "locator": "",
                    "loc_start": pno,
                    "created_at": None,
                    "source": "pdf",
                })
                count += 1
        doc.close()
        if count:
            log(f"  《{title}》：{count} 条划线")
    return books, highlights


# ---------------- Kindle（二期预留） ----------------

def collect_kindle():
    """二期：解析 Kindle 的 My Clippings.txt。接口预留。"""
    return {}, []


# ---------------- 主流程 ----------------

def main():
    os.makedirs(DATA, exist_ok=True)
    settings = load_json(SETTINGS_JSON, {})
    merged_settings = dict(DEFAULT_SETTINGS)
    merged_settings.update(settings)
    # 环境变量可覆盖 PDF 目录
    if os.environ.get("READING_ROOM_PDF_DIR"):
        merged_settings["pdf_dir"] = os.environ["READING_ROOM_PDF_DIR"]
    save_json(SETTINGS_JSON, merged_settings)
    # thoughts.json 占位
    if not os.path.exists(THOUGHTS_JSON):
        save_json(THOUGHTS_JSON, [])

    old_books = {b["id"]: b for b in load_json(BOOKS_JSON, [])}
    old_highlights = {h["id"]: h for h in load_json(HIGHLIGHTS_JSON, [])}
    deleted = set(load_json(DELETED_JSON, []))  # 用户删掉的，不再捡回来

    all_books = dict(old_books)
    new_highlights = dict(old_highlights)

    for name, fn in [("图书 App", collect_apple_books),
                     ("PDF", lambda: collect_pdfs(merged_settings["pdf_dir"])),
                     ("Kindle", collect_kindle)]:
        try:
            books, highlights = fn()
        except Exception as e:
            log(f"{name} 采集异常：{e}")
            continue
        for bid, b in books.items():
            if bid in all_books:
                # 书名/作者回填（旧数据可能是"未知书名"）
                old = all_books[bid]
                if old.get("title") in (None, "", "未知书名") and b.get("title"):
                    old["title"] = b["title"]
                if not old.get("author") and b.get("author"):
                    old["author"] = b["author"]
                old.setdefault("status", "reading")
            else:
                b.setdefault("status", "reading")
                b["highlight_count"] = 0
                all_books[bid] = b
        added = 0
        for h in highlights:
            if h["id"] in deleted:
                continue
            if h["id"] not in new_highlights:
                new_highlights[h["id"]] = h
                added += 1
        log(f"{name}：新增 {added} 条（累计 {len(new_highlights)} 条）")

    # 回填每本书的划线数
    counts = {}
    for h in new_highlights.values():
        counts[h["book_id"]] = counts.get(h["book_id"], 0) + 1
    for bid, b in all_books.items():
        b["highlight_count"] = counts.get(bid, 0)
    # 没有划线的书也保留（可能是刚加入的），但去掉 highlight_count=0 且来源不明的脏数据？保留，简单起见。

    save_json(BOOKS_JSON, sorted(all_books.values(), key=lambda b: b.get("title", "")))
    save_json(HIGHLIGHTS_JSON, sorted(new_highlights.values(),
                                      key=lambda h: h.get("created_at") or "", reverse=True))
    log(f"完成：{len(all_books)} 本书，{len(new_highlights)} 条划线")


if __name__ == "__main__":
    main()
