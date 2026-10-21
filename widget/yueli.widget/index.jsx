// 阅历 · 桌面轮播组件（Übersicht）
// 轮播划线卡片 + 随手记。数据来自本机服务 http://127.0.0.1:8765
// 轮播间隔 / 随笔是否参与轮播 / 随机或顺序 —— 在「书房」总览页的设置里调

// 版本号：显示在卡片角落，方便确认是否为最新版
const VERSION = "1.6.1";

export const command = (dispatch) => {
  // 注意：Übersicht 2.x 的 render 不再把 dispatch 放进 props，
  // 但 command 的参数里一定有。这里捕获一份，事件处理器全部走它。
  dispatchFn = dispatch;
  fetchQueue();
};

function fetchQueue() {
  fetch("http://127.0.0.1:8765/api/queue")
    .then((r) => {
      if (!r.ok) throw new Error("服务无响应");
      return r.json();
    })
    .then((data) => D({ type: "QUEUE", data }))
    .catch((e) => D({ type: "ERROR", error: String((e && e.message) || e) }));
}

export const refreshFrequency = false;

export const className = {
  right: "28px",
  bottom: "28px",
  width: "380px",
  pointerEvents: "none", // 外层不拦截鼠标，内层卡片自己处理定位与拖拽
  fontFamily: '"Songti SC", "STSong", "Noto Serif SC", serif',
};

export const initialState = {
  status: "loading", // loading | ready | error
  queue: [],
  settings: {},
  index: 0,
  justSaved: false,
  error: "",
  deleteArmed: null, // 删除二次确认中："kind:id"，4 秒无操作自动解除
  openMsg: "", // 回原书的临时提示（跳转中/成功/失败原因）
};

// ---- 模块级：dispatch 捕获、轮播计时器、输入草稿与删除二次确认 ----
let dispatchFn = null;
let timer = null;
let timerIntervalSec = null;
let draft = "";
let deleteArmTimer = null;

// 统一的 dispatch 入口：2.x 下 render 的 props 里没有 dispatch，
// 所以事件处理器（按钮点击、计时器）全部走这里
function D(event) {
  if (dispatchFn) dispatchFn(event);
}

// 键盘左右切换：全局只注册一次。
// 焦点在随笔框 / 输入框里时不拦截——那时左右键是移动光标的，不能被抢走。
// 注意：Übersicht 组件窗口需要先被点过（获得键盘焦点），方向键才送达这里。
let keyListenerReady = false;
function ensureKeyListener() {
  if (keyListenerReady) return;
  keyListenerReady = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || ae.isContentEditable)) return;
    e.preventDefault();
    D({ type: e.key === "ArrowLeft" ? "PREV" : "NEXT" });
  });
}

function ensureTimer(status, settings) {
  if (status !== "ready") {
    if (timer) { clearInterval(timer); timer = null; timerIntervalSec = null; }
    return;
  }
  const iv = Math.max(5, parseInt(settings.carousel_interval_sec, 10) || 120);
  if (!timer || timerIntervalSec !== iv) {
    if (timer) clearInterval(timer);
    timerIntervalSec = iv;
    timer = setInterval(() => D({ type: "NEXT" }), iv * 1000);
  }
}

function saveThought(highlightId) {
  const text = draft.trim();
  if (!text || !highlightId) return;
  fetch("http://127.0.0.1:8765/api/thought", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ highlight_id: highlightId, text }),
  })
    .then((r) => r.json())
    .then((res) => {
      if (res.ok) {
        draft = "";
        D({ type: "SAVED" });
        setTimeout(() => D({ type: "SAVED_CLEAR" }), 2200);
      }
    })
    .catch(() => {});
}

// 删除：两步确认。第一步 arm（按钮变"确认删除？"，4 秒自动解除），
// 第二步才真正发请求；成功后从本地队列里拿掉这一条
function armDelete(key) {
  D({ type: "DELETE_ARM", key });
  if (deleteArmTimer) clearTimeout(deleteArmTimer);
  deleteArmTimer = setTimeout(() => D({ type: "DELETE_DISARM" }), 4000);
}

function doDelete(card) {
  if (deleteArmTimer) { clearTimeout(deleteArmTimer); deleteArmTimer = null; }
  draft = "";
  fetch("http://127.0.0.1:8765/api/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: card.kind, id: card.id }),
  })
    .then((r) => r.json())
    .then((res) => {
      if (res.ok) D({ type: "DELETED", kind: card.kind, id: card.id });
      else D({ type: "DELETE_DISARM" });
    })
    .catch(() => D({ type: "DELETE_DISARM" }));
}

// 回原书：请服务端打开原书并定位（图书 App 自动搜原文；PDF 打开文件）。
// 跳转要几秒，结果通过卡片底部的提示行反馈
function openSource(card) {
  D({ type: "OPEN_MSG", msg: "正在回原书…" });
  fetch("http://127.0.0.1:8765/api/open-source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: card.kind, id: card.id }),
  })
    .then((r) => r.json())
    .then((res) => {
      D({ type: "OPEN_MSG", msg: res.ok ? "已打开原书，看一下图书 App" : (res.error || "跳转失败") });
      setTimeout(() => D({ type: "OPEN_MSG_CLEAR" }), 5000);
    })
    .catch(() => {
      D({ type: "OPEN_MSG", msg: "跳转失败：本地服务无响应" });
      setTimeout(() => D({ type: "OPEN_MSG_CLEAR" }), 5000);
    });
}

export const updateState = (event, prev) => {
  switch (event.type) {
    case "QUEUE": {
      const queue = event.data.queue || [];
      const settings = event.data.settings || {};
      return { ...prev, status: "ready", queue, settings, index: 0, justSaved: false,
               srvVersion: event.data.version || "" };
    }
    case "NEXT":
      if (!prev.queue.length) return prev;
      return { ...prev, index: (prev.index + 1) % prev.queue.length, justSaved: false, deleteArmed: null, openMsg: "" };
    case "PREV":
      if (!prev.queue.length) return prev;
      return { ...prev, index: (prev.index - 1 + prev.queue.length) % prev.queue.length, justSaved: false, deleteArmed: null, openMsg: "" };
    case "OPEN_MSG":
      return { ...prev, openMsg: event.msg };
    case "OPEN_MSG_CLEAR":
      if (!prev.openMsg) return prev;
      return { ...prev, openMsg: "" };
    case "RELOAD":
      return { ...prev, status: "loading", deleteArmed: null };
    case "DELETE_ARM":
      return { ...prev, deleteArmed: event.key };
    case "DELETE_DISARM":
      if (!prev.deleteArmed) return prev;
      return { ...prev, deleteArmed: null };
    case "DELETED": {
      const queue = prev.queue.filter((c) => !(c.kind === event.kind && c.id === event.id));
      let index = prev.index;
      if (index >= queue.length) index = 0;
      // 草稿框一起清空并重挂载，避免误删后随笔错关联到下一条
      return { ...prev, queue, index, deleteArmed: null, saveKey: (prev.saveKey || 0) + 1 };
    }
    case "ERROR":
      return { ...prev, status: "error", error: event.error };
    case "SAVED":
      return { ...prev, justSaved: true, saveKey: (prev.saveKey || 0) + 1 };
    case "SAVED_CLEAR":
      return { ...prev, justSaved: false };
    default:
      return prev;
  }
};

// 重新拉取队列（设置改了之后点一下）
function reload() {
  if (timer) { clearInterval(timer); timer = null; timerIntervalSec = null; }
  D({ type: "RELOAD" });
  fetchQueue();
}

const cardStyle = {
  background: "rgba(24, 20, 15, 0.78)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: "1px solid rgba(201, 162, 75, 0.28)",
  borderRadius: "18px",
  padding: "20px 22px 16px",
  color: "#e9e2d4",
  boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
};

const labelStyle = {
  fontSize: "11px",
  letterSpacing: "3px",
  color: "#c9a24b",
  marginBottom: "10px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

// 卡片定位与拖拽：内层用 fixed 定位，顶栏做拖拽手柄，位置记在 localStorage
const wrapStyle = {
  position: "fixed",
  width: "380px",
  pointerEvents: "auto",
};

function initPos(el) {
  if (!el) return;
  try {
    const raw = localStorage.getItem("yueli-pos");
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.left) {
        el.style.left = p.left;
        el.style.top = p.top;
        el.style.right = "auto";
        el.style.bottom = "auto";
        return;
      }
    }
  } catch (e) {}
  el.style.right = "28px";
  el.style.bottom = "28px";
  el.style.left = "auto";
  el.style.top = "auto";
}

function onDragStart(e) {
  if (e.button !== 0) return; // 只响应左键
  const el = document.getElementById("yueli-card-wrap");
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const offX = e.clientX - rect.left;
  const offY = e.clientY - rect.top;
  el.style.left = rect.left + "px";
  el.style.top = rect.top + "px";
  el.style.right = "auto";
  el.style.bottom = "auto";
  const move = (ev) => {
    el.style.left = Math.max(0, ev.clientX - offX) + "px";
    el.style.top = Math.max(0, ev.clientY - offY) + "px";
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    try {
      localStorage.setItem("yueli-pos", JSON.stringify({ left: el.style.left, top: el.style.top }));
    } catch (err) {}
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  e.preventDefault();
}

const dragHandleStyle = { cursor: "grab", userSelect: "none", WebkitUserSelect: "none" };

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

const renderContent = (props) => {
  // 注意：2.x 的 props 里没有 dispatch，事件全部走模块级的 D()
  const { status, queue, settings, index, justSaved, saveKey, openMsg, srvVersion } = props;
  ensureTimer(status, settings || {});
  ensureKeyListener();

  if (status === "loading") {
    return <div style={cardStyle}><div style={{ fontSize: 13, color: "#9a917f" }}>正在连接书房…</div></div>;
  }

  if (status === "error") {
    return (
      <div style={cardStyle}>
        <div style={{ ...labelStyle, ...dragHandleStyle }} onMouseDown={onDragStart} title="按住拖动卡片">
          <span>阅历 · 划线轮播</span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>
          本地服务还没启动。<br />
          <span style={{ color: "#9a917f", fontSize: 12 }}>双击运行 ~/.reading-room/ 目录下的「启动书房.command」即可。</span>
        </div>
        <button onClick={reload} style={btnStyle}>重试连接</button>
        <div style={{ marginTop: 10, fontSize: 10, color: "#6f695c", textAlign: "right" }}>v{VERSION}</div>
      </div>
    );
  }

  if (!queue.length) {
    return (
      <div style={cardStyle}>
        <div style={{ ...labelStyle, ...dragHandleStyle }} onMouseDown={onDragStart} title="按住拖动卡片"><span>阅历 · 划线轮播</span></div>
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "#9a917f" }}>
          还没有划线。<br />先去图书 App / PDF 里划几句，然后运行一次采集脚本。
        </div>
      </div>
    );
  }

  const card = queue[index % queue.length];
  const isThought = card.kind === "thought";
  const cardKey = card.kind + ":" + card.id;
  const { deleteArmed } = props;
  const total = queue.length;
  const intervalMin = Math.round((settings.carousel_interval_sec || 120) / 60 * 10) / 10;

  return (
    <div style={cardStyle}>
      <div style={{ ...labelStyle, ...dragHandleStyle }} onMouseDown={onDragStart} title="按住拖动卡片">
        <span>{isThought ? "✎ 我的随笔" : "❝ 划线轮播"}</span>
        <span style={{ letterSpacing: 1, color: "#8a8272" }}>
          {(index % total) + 1} / {total} · {intervalMin} 分钟
        </span>
      </div>

      {isThought ? (
        <div>
          <div style={{ fontSize: 12, color: "#9a917f", borderLeft: "2px solid #c9a24b",
                       paddingLeft: 10, marginBottom: 10, lineHeight: 1.7 }}>
            「{(card.quote || "").slice(0, 60)}{(card.quote || "").length > 60 ? "…" : ""}」
          </div>
          <div style={{ fontSize: 15, lineHeight: 2 }}>{card.text}</div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 16, lineHeight: 2, marginBottom: 12 }}>{card.text}</div>
          {card.note && (
            <div style={{ fontSize: 13, color: "#c9a24b", marginBottom: 10 }}>批注：{card.note}</div>
          )}
        </div>
      )}

      <div style={{ fontSize: 12, color: "#9a917f", marginTop: 6, marginBottom: 14 }}>
        《{card.book_title || "未知"}》{card.author ? ` · ${card.author}` : ""}
        {card.location ? ` · ${card.location}` : ""}
        {fmtDate(card.created_at) ? ` · ${fmtDate(card.created_at)}` : ""}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => D({ type: "PREV" })} style={btnGhost}>← 上一条</button>
        <button onClick={() => D({ type: "NEXT" })} style={btnGhost}>下一条 →</button>
        <button onClick={reload} style={btnGhost} title="重新从服务拉取（含最新设置）">↻</button>
        <span style={{ flex: 1 }} />
        {deleteArmed === cardKey ? (
          <button onClick={() => doDelete(card)} style={btnDanger}>确认删除？</button>
        ) : (
          <button onClick={() => armDelete(cardKey)} style={btnGhost} title="从书房中删掉这条">删除</button>
        )}
      </div>

      <div style={{ borderTop: "1px solid rgba(201,162,75,0.18)", paddingTop: 12 }}>
        <textarea
          key={saveKey || 0}
          rows={2}
          placeholder="这句话让你想到了什么？写下来…"
          onChange={(e) => { draft = e.target.value; }}
          style={{
            width: "100%", boxSizing: "border-box", resize: "none",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(201,162,75,0.25)",
            borderRadius: 10, padding: "10px 12px", color: "#e9e2d4",
            fontSize: 13, lineHeight: 1.7, outline: "none",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: justSaved ? "#c9a24b" : "#6f695c" }}>
            {justSaved ? "✓ 已记下，关联到当前这条" : "将关联到当前这条划线"}
          </span>
          <button onClick={() => saveThought(card.highlight_id || card.id)} style={btnStyle}>
            记一笔
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: (openMsg || (srvVersion && srvVersion !== VERSION)) ? "#c9a24b" : "#6f695c" }}>
          {openMsg || (srvVersion && srvVersion !== VERSION
            ? `新版 v${srvVersion} 已就绪，Übersicht 里 Refresh 一下生效`
            : `顶栏可拖动 · ← → 切换 · v${VERSION}`)}
        </span>
        <span onClick={() => openSource(card)} title="在图书 App 打开原书，并自动定位到这句"
              style={{ fontSize: 11, color: "#9a917f", cursor: "pointer" }}>
          回原书 ↗
        </span>
        <a href="http://127.0.0.1:8765" style={{ fontSize: 11, color: "#6f695c", textDecoration: "none" }}>
          书房总览页 →
        </a>
      </div>
    </div>
  );
};

export const render = (props) => (
  <div id="yueli-card-wrap" ref={initPos} style={wrapStyle}>
    {renderContent(props)}
  </div>
);

const btnStyle = {
  background: "#c9a24b", color: "#1c1712", border: "none", borderRadius: 9,
  padding: "7px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};

const btnGhost = {
  background: "transparent", color: "#9a917f", border: "1px solid rgba(201,162,75,0.25)",
  borderRadius: 9, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

const btnDanger = {
  background: "rgba(200,80,80,0.16)", color: "#e08080", border: "1px solid rgba(200,80,80,0.55)",
  borderRadius: 9, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
