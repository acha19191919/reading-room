/* 阅历书房 · 总览页逻辑 */
const API = "";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};

const STATUS_LABEL = { reading: "在读", finished: "读完", planned: "计划读", paused: "暂停" };

/* ---------- 复制书摘（Markdown 引用格式） ---------- */
function copyFeedback(btn) {
  const old = btn.textContent;
  btn.textContent = "已复制 ✓";
  setTimeout(() => { btn.textContent = old; }, 1600);
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  if (btn) copyFeedback(btn);
}
function hlToMarkdown(h) {
  const lines = String(h.text || "").split("\n").map((l) => `> ${l}`).join("\n");
  const src = [`《${h.book_title || "未知"}》`];
  if (h.author) src.push(h.author);
  if (h.location) src.push(h.location);
  let out = `${lines}\n>\n> —— ${src.join(" · ")}`;
  if (h.note) out += `\n\n批注：${h.note}`;
  return out;
}
function thoughtToMarkdown(t) {
  let out = t.text || "";
  if (t.quote) out += `\n\n> ${t.quote}\n> —— 《${t.book_title || "未知"}》`;
  return out;
}

/* ---------- 回原书（服务端打开原书并定位） ---------- */
async function jumpToSource(kind, id, btn) {
  const old = btn.textContent;
  btn.textContent = "跳转中…";
  try {
    const res = await fetch(`${API}/api/open-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
    }).then((r) => r.json());
    btn.textContent = res.ok ? "已打开 ✓" : "跳转失败";
    btn.title = res.ok ? "" : (res.error || "未知错误");
  } catch (e) {
    btn.textContent = "跳转失败";
    btn.title = "本地服务无响应";
  }
  setTimeout(() => { btn.textContent = old; }, 4000);
}

let STATE = { books: [], highlights: [], thoughts: [], settings: {} };
let QUEUE = [];
let heroIdx = 0, heroTimer = null, imgIdx = 0;

/* ---------- 启动 ---------- */
async function boot() {
  try {
    const [stateRes, queueRes] = await Promise.all([
      fetch(`${API}/api/state`).then((r) => r.json()),
      fetch(`${API}/api/queue`).then((r) => r.json()),
    ]);
    STATE = stateRes;
    QUEUE = queueRes.queue || [];
    document.getElementById("ver").textContent = "v" + (stateRes.version || "");
    initSettings(stateRes.settings);
  } catch (e) {
    document.querySelector(".hero-quote").textContent = "本地服务未启动，请先运行「启动书房.command」。";
    return;
  }
  initHeroImages();
  startHeroQuote();
  renderStats();
  renderHeatmap();
  renderShelf();
  renderTimeline();
}

/* ---------- Hero：图片轮播 ---------- */
function initHeroImages() {
  const hero = document.getElementById("hero");
  const candidates = [];
  for (let i = 1; i <= 8; i++) candidates.push(`assets/hero${i}.jpg`);
  const loaded = [];
  let pending = candidates.length;
  candidates.forEach((src) => {
    const img = new Image();
    img.onload = () => { loaded.push(src); done(); };
    img.onerror = () => done();
    img.src = src;
  });
  function done() {
    if (--pending > 0) return;
    if (!loaded.length) return; // 无图就用纯色背景
    loaded.sort();
    const layers = loaded.map((src) => {
      const d = document.createElement("div");
      d.className = "hero-bg";
      d.style.backgroundImage = `url("${src}")`;
      hero.prepend(d);
      return d;
    });
    const dots = document.getElementById("heroDots");
    layers.forEach(() => dots.appendChild(document.createElement("span")));
    const show = (i) => {
      layers.forEach((l, j) => l.classList.toggle("on", j === i));
      [...dots.children].forEach((s, j) => s.classList.toggle("on", j === i));
    };
    show(0);
    setInterval(() => { imgIdx = (imgIdx + 1) % layers.length; show(imgIdx); }, 12000);
  }
}

/* ---------- Hero：划线轮播 ---------- */
function startHeroQuote() {
  const el = document.getElementById("heroQuote");
  const meta = document.getElementById("heroMeta");
  if (!QUEUE.length) {
    el.textContent = "还没有划线，去书里划下第一句吧。";
    meta.textContent = "";
    return;
  }
  const iv = Math.max(5, parseInt(STATE.settings.carousel_interval_sec, 10) || 120);
  const show = () => {
    const card = QUEUE[heroIdx % QUEUE.length];
    el.style.opacity = 0;
    meta.style.opacity = 0;
    setTimeout(() => {
      if (card.kind === "thought") {
        el.textContent = card.text;
        meta.textContent = `我的随笔 · 《${card.book_title || "未知"}》 · ${fmtDate(card.created_at)}`;
      } else {
        el.textContent = "「" + card.text + "」";
        meta.textContent = `《${card.book_title || "未知"}》${card.author ? " · " + card.author : ""}`;
      }
      el.style.opacity = 1;
      meta.style.opacity = 1;
    }, 450);
    heroIdx++;
  };
  el.style.transition = "opacity 0.45s";
  meta.style.transition = "opacity 0.45s";
  show();
  if (heroTimer) clearInterval(heroTimer);
  heroTimer = setInterval(show, iv * 1000);
}

/* ---------- 数据条 ---------- */
function renderStats() {
  const days = activeDays();
  document.getElementById("statBooks").textContent = STATE.books.length;
  document.getElementById("statHighlights").textContent = STATE.highlights.length;
  document.getElementById("statThoughts").textContent = STATE.thoughts.length;
  document.getElementById("statStreak").textContent = streak();
}

function activeDays() {
  const set = new Set();
  [...STATE.highlights, ...STATE.thoughts].forEach((x) => {
    if (x.created_at) set.add(x.created_at.slice(0, 10));
  });
  return set;
}

function streak() {
  const days = activeDays();
  let n = 0;
  const d = new Date();
  const key = (dt) => dt.toISOString().slice(0, 10);
  if (!days.has(key(d))) d.setDate(d.getDate() - 1); // 今天还没记，从昨天算
  while (days.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- 热力图 ---------- */
function renderHeatmap() {
  const wrap = document.getElementById("heatmap");
  const counts = {};
  [...STATE.highlights, ...STATE.thoughts].forEach((x) => {
    if (!x.created_at) return;
    const k = x.created_at.slice(0, 10);
    counts[k] = (counts[k] || 0) + 1;
  });
  const days = 182;
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  // 对齐到周一
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);

  const cols = [];
  const cur = new Date(start);
  let col = [];
  while (cur <= today) {
    const k = cur.toISOString().slice(0, 10);
    const c = counts[k] || 0;
    const lvl = c === 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 10 ? 3 : 4;
    const future = cur > today;
    col.push(`<div class="hm-cell${lvl ? " l" + lvl : ""}" title="${k} · ${c} 条"></div>`);
    if (col.length === 7) { cols.push(`<div class="hm-col">${col.join("")}</div>`); col = []; }
    cur.setDate(cur.getDate() + 1);
  }
  if (col.length) cols.push(`<div class="hm-col">${col.join("")}</div>`);
  wrap.innerHTML = `<div class="heatmap">${cols.join("")}</div>
    <div class="hm-legend">过去 26 周 · 颜色越深，划线与随笔越多</div>`;
}

/* ---------- 书架 ---------- */
function renderShelf() {
  const shelf = document.getElementById("shelf");
  const books = [...STATE.books].sort(
    (a, b) => (b.highlight_count || 0) - (a.highlight_count || 0));
  if (!books.length) {
    shelf.innerHTML = `<div class="empty">还没有书。运行一次采集脚本，书架就会出现。</div>`;
    return;
  }
  shelf.innerHTML = books.map((b) => `
    <div class="book" data-book="${esc(b.id)}">
      <h3>《${esc(b.title)}》</h3>
      <div class="author">${esc(b.author || "佚名")} · ${esc(b.source === "pdf" ? "PDF" : b.source === "applebooks" ? "图书 App" : b.source)}</div>
      <div class="row">
        <span class="badge ${b.status === "finished" ? "finished" : b.status === "planned" ? "planned" : b.status === "paused" ? "paused" : ""}">${STATUS_LABEL[b.status] || "在读"}</span>
        <span class="count">${b.highlight_count || 0} 条划线</span>
      </div>
    </div>`).join("");

  shelf.querySelectorAll(".book").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.target.tagName === "SELECT") return;
      toggleBookDetail(el.dataset.book, el);
    });
  });
}

function toggleBookDetail(bookId, anchorEl) {
  const existing = document.querySelector(".book-detail");
  if (existing) existing.remove();
  if (anchorEl.dataset.open === "1") { anchorEl.dataset.open = ""; return; }
  document.querySelectorAll(".book").forEach((b) => (b.dataset.open = ""));
  anchorEl.dataset.open = "1";

  const book = STATE.books.find((b) => b.id === bookId);
  const hls = STATE.highlights.filter((h) => h.book_id === bookId);
  const thoughtsByHl = {};
  STATE.thoughts.filter((t) => t.book_id === bookId).forEach((t) => {
    (thoughtsByHl[t.highlight_id] = thoughtsByHl[t.highlight_id] || []).push(t);
  });

  const detail = document.createElement("div");
  detail.className = "book-detail";
  detail.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
      <div class="section-sub" style="margin:0;">《${esc(book.title)}》</div>
      <select id="statusSel" class="badge" style="background:transparent;cursor:pointer;">
        ${Object.entries(STATUS_LABEL).map(([v, l]) =>
          `<option value="${v}" ${book.status === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    ${hls.length ? hls.map((h) => `
      <div class="hl-item">
        <div class="t">「${esc(h.text)}」</div>
        <div class="m">${esc(h.location || "")} ${fmtDate(h.created_at) ? "· " + fmtDate(h.created_at) : ""}<button class="copy-btn" data-copy-hl="${esc(h.id)}" title="复制为 Markdown 引用，粘到笔记里就能用">复制</button><button class="copy-btn" data-open-hl="${esc(h.id)}" title="打开原书并定位到这句（PDF 只打开文件）">回原书</button></div>
        ${(thoughtsByHl[h.id] || []).map((t) => `
          <div class="thought">✎ ${esc(t.text)}<div class="m">${fmtDate(t.created_at)}</div></div>`).join("")}
      </div>`).join("")
      : `<div class="empty">这本书还没有划线。</div>`}`;
  anchorEl.after(detail);
  detail.querySelectorAll("[data-copy-hl]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const h = STATE.highlights.find((x) => x.id === btn.dataset.copyHl);
      if (h) copyText(hlToMarkdown(h), btn);
    });
  });
  detail.querySelectorAll("[data-open-hl]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToSource("highlight", btn.dataset.openHl, btn));
  });
  detail.querySelector("#statusSel").addEventListener("change", async (e) => {
    await fetch(`${API}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bookId, status: e.target.value }),
    });
    book.status = e.target.value;
    renderShelf();
  });
}

/* ---------- 随笔时间线 ---------- */
function renderTimeline() {
  const tl = document.getElementById("timeline");
  const thoughts = [...STATE.thoughts].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 20);
  if (!thoughts.length) {
    tl.innerHTML = `<div class="empty">还没有随笔。在桌面组件上看到有感的句子，随手记一笔吧。</div>`;
    return;
  }
  tl.innerHTML = thoughts.map((t) => `
    <div class="tl-item">
      ${t.quote ? `<div class="q">「${esc(t.quote)}」——《${esc(t.book_title)}》</div>` : ""}
      <div class="x">${esc(t.text)}</div>
      <div class="m">${fmtDate(t.created_at)}<button class="copy-btn" data-copy-th="${esc(t.id)}" title="复制随笔（附所引划线）">复制</button><button class="copy-btn" data-open-th="${esc(t.id)}" title="打开这条随笔引用的原书位置">回原书</button></div>
    </div>`).join("");
  tl.querySelectorAll("[data-copy-th]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = STATE.thoughts.find((x) => x.id === btn.dataset.copyTh);
      if (t) copyText(thoughtToMarkdown(t), btn);
    });
  });
  tl.querySelectorAll("[data-open-th]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToSource("thought", btn.dataset.openTh, btn));
  });
}

/* ---------- 设置 ---------- */
function initSettings(s) {
  const iv = parseInt(s.carousel_interval_sec, 10) || 120;
  const slider = document.getElementById("setInterval");
  slider.value = Math.min(1800, Math.max(30, iv));
  updateIntervalLabel();
  document.getElementById("setThoughts").checked = !!s.thoughts_in_carousel;
  document.getElementById("setMode").value = s.carousel_mode || "random";

  document.getElementById("fab").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.toggle("open");
  });
  slider.addEventListener("input", updateIntervalLabel);
  document.getElementById("saveSettings").addEventListener("click", saveSettings);
}

function updateIntervalLabel() {
  const v = parseInt(document.getElementById("setInterval").value, 10);
  document.getElementById("intervalVal").textContent =
    v >= 60 ? `${Math.round(v / 60 * 10) / 10} 分钟` : `${v} 秒`;
}

async function saveSettings() {
  const body = {
    carousel_interval_sec: parseInt(document.getElementById("setInterval").value, 10),
    thoughts_in_carousel: document.getElementById("setThoughts").checked,
    carousel_mode: document.getElementById("setMode").value,
  };
  const res = await fetch(`${API}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  if (res.ok) {
    STATE.settings = res.settings;
    const q = await fetch(`${API}/api/queue`).then((r) => r.json());
    QUEUE = q.queue || [];
    heroIdx = 0;
    startHeroQuote();
    document.getElementById("settingsPanel").classList.remove("open");
    // 桌面组件点一下 ↻ 即可按新设置轮播
  }
}

document.addEventListener("DOMContentLoaded", boot);
