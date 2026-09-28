/* ==========================================================
   因子智投 · 页面交互逻辑（纯前端，数据见 data.js）
   ========================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmtPct = (v, signed = true) =>
  v == null ? "—" : (signed && v > 0 ? "+" : "") + v.toFixed(1) + "%";

const upDownCls = v => (v > 0 ? "up" : v < 0 ? "down" : "");

const nowTime = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

const escapeHtml = s =>
  String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/* ===== Toast 轻提示 ===== */
let toastTimer = null;
function toast(msg) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ===== SVG 图表工具 ===== */
function sparklineSVG(data, width = 320, height = 56) {
  if (!data || data.length < 2) return "";
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 4, range = (max - min) || 1;
  const x = i => (i / (data.length - 1)) * (width - 2) + 1;
  const y = v => max === min
    ? height / 2
    : height - pad - ((v - min) / range) * (height - pad * 2);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const rising = data[data.length - 1] >= data[0];
  const color = rising ? "#e0343c" : "#0a9e63";   // A股惯例：红涨绿跌
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".22"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="1,${height} ${pts} ${width - 1},${height}" fill="url(#${gid})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"
        stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

/* 绩效回测曲线（组合 vs 基准） */
const totalReturnPct = arr => (arr[arr.length - 1] / arr[0] - 1) * 100;

function backtestChartSVG(p, bench, width = 640, height = 190) {
  const padL = 46, padR = 12, padT = 14, padB = 26;
  const lo = Math.floor((Math.min(...p, ...bench) - 2) / 5) * 5;
  const hi = Math.ceil((Math.max(...p, ...bench) + 2) / 5) * 5;
  const x = i => padL + (i / (p.length - 1)) * (width - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo || 1)) * (height - padT - padB);
  const pts = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const gid = "bg" + Math.random().toString(36).slice(2, 8);
  const xLabels = ["2023-09", "2024-06", "2025-06", "2026-09"];
  return `
    <svg viewBox="0 0 ${width} ${height}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4f5df0" stop-opacity=".18"/>
        <stop offset="1" stop-color="#4f5df0" stop-opacity="0"/>
      </linearGradient></defs>
      ${[0, 1, 2, 3].map(i => {
        const v = lo + ((hi - lo) * i) / 3;
        const yy = y(v).toFixed(1);
        return `<line x1="${padL}" y1="${yy}" x2="${width - padR}" y2="${yy}" stroke="#eef1f7" stroke-width="1"/>
          <text x="${padL - 8}" y="${+yy + 4}" text-anchor="end" font-size="11" fill="#98a1b3">${Math.round(v)}</text>`;
      }).join("")}
      ${xLabels.map((t, i) => {
        const xx = x((i / (xLabels.length - 1)) * (p.length - 1)).toFixed(1);
        return `<text x="${xx}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}" font-size="11" fill="#98a1b3">${t}</text>`;
      }).join("")}
      <polygon points="${padL},${height - padB} ${pts(p)} ${width - padR},${height - padB}" fill="url(#${gid})"/>
      <polyline points="${pts(bench)}" fill="none" stroke="#b3bccb" stroke-width="1.8" stroke-dasharray="5 4"/>
      <polyline points="${pts(p)}" fill="none" stroke="#4f5df0" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

function perfChartBlock(curve, benchCurve, benchName) {
  if (!curve || !benchCurve) return "";
  const pr = totalReturnPct(curve), br = totalReturnPct(benchCurve);
  const ex = pr - br;
  return `
    <div class="bt-chart">
      <div class="bt-legend">
        <span><i class="lg-line"></i>策略组合</span>
        <span><i class="lg-line lg-bench"></i>业绩基准（${benchName || "业绩基准"}）</span>
      </div>
      ${backtestChartSVG(curve, benchCurve)}
      <div class="bt-return">
        <div class="btr-item">
          <span class="btr-label">组合区间收益</span>
          <span class="btr-val ${upDownCls(pr)}">${fmtPct(pr)}</span>
        </div>
        <div class="btr-item">
          <span class="btr-label">基准区间收益</span>
          <span class="btr-val ${upDownCls(br)}">${fmtPct(br)}</span>
        </div>
        <div class="btr-item">
          <span class="btr-label">超额收益</span>
          <span class="btr-val ${upDownCls(ex)}">${fmtPct(ex)}</span>
        </div>
      </div>
    </div>`;
}

/* 回测假设参数说明 */
function btParamsHTML() {
  return `
    <div class="bt-params">
      ${BT_PARAMS.map(p => `
        <div class="btp-item" title="${p.hint}">
          <div class="btp-label">${p.label}</div>
          <div class="btp-val">${p.value}</div>
        </div>`).join("")}
    </div>`;
}

function radarSVG(items) {
  const cx = 130, cy = 112, R = 78, N = items.length;
  const angle = i => (Math.PI * 2 * i) / N - Math.PI / 2;
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const ringPath = ratio =>
    items.map((_, i) => pt(i, R * ratio).map(n => n.toFixed(1)).join(",")).join(" ");
  const dataPts = items.map((it, i) => pt(i, (R * it.value) / 100));
  const dataPoly = dataPts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ");
  const axes = items
    .map((it, i) => {
      const [lx, ly] = pt(i, R + 18);
      const anchor = Math.abs(lx - cx) < 10 ? "middle" : lx > cx ? "start" : "end";
      return `<line x1="${cx}" y1="${cy}" x2="${pt(i, R)[0].toFixed(1)}" y2="${pt(i, R)[1].toFixed(1)}"
        stroke="#dfe4ee" stroke-width="1"/>
        <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}"
        font-size="11" fill="#5a6478">${it.name} ${it.value}</text>`;
    })
    .join("");
  const dots = dataPts
    .map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#4f5df0"/>`)
    .join("");
  return `
    <svg viewBox="0 0 260 230">
      ${[0.25, 0.5, 0.75, 1].map(r =>
        `<polygon points="${ringPath(r)}" fill="none" stroke="#e8ecf4" stroke-width="1"/>`).join("")}
      ${axes}
      <polygon points="${dataPoly}" fill="rgba(79,93,240,.18)" stroke="#4f5df0" stroke-width="2"/>
      ${dots}
    </svg>`;
}

/* ===== 页面导航 ===== */
function gotoPage(name) {
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === name));
  $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + name));
}
$$(".nav-item").forEach(btn =>
  btn.addEventListener("click", () => gotoPage(btn.dataset.page)));
$$("[data-goto]").forEach(btn =>
  btn.addEventListener("click", () => gotoPage(btn.dataset.goto)));
$("#sidebar-user").addEventListener("click", () => gotoPage("profile"));

/* ==========================================================
   页面1：对话选股 — 多会话管理 + 多轮对话
   会话数据存 localStorage，刷新不丢失
   ========================================================== */
const chatBody = $("#chat-body");
const chatInput = $("#chat-input");

const CONV_KEY = "alphasage_conversations_v1";
const AGENT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px">
  <path d="M3 20 L7 12 L11 15 L15 6 L18 10 L21 4"/></svg>`;

const WELCOME_TEXT =
  "你好，陈研究员 👋 我是你的多因子选股智能体。\n\n我可以帮你：\n· 构建多因子选股策略（价值 / 成长 / 动量 / 质量 / 低波动等）\n· 对策略进行历史回测与绩效归因\n· 按条件筛选股票并输出综合因子得分\n\n试试下方的快捷指令，或直接描述你的需求。";

let conversations = [];   // { id, title, messages: [{role, bubble, card, time}], updatedAt }
let currentConvId = null;

const currentConv = () => conversations.find(c => c.id === currentConvId);

function persistChat() {
  try {
    localStorage.setItem(CONV_KEY, JSON.stringify({ conversations, currentConvId }));
  } catch (e) { /* 存储不可用时忽略，仅影响刷新恢复 */ }
}

function fmtConvDate(ts) {
  const d = new Date(ts), now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return d.toDateString() === now.toDateString()
    ? hm
    : String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ----- 消息渲染 ----- */
function msgHTML(m) {
  const isUser = m.role === "user";
  return `
    <div class="msg ${m.role}">
      <div class="msg-avatar">${isUser ? "陈" : AGENT_SVG}</div>
      <div class="msg-content">
        <div class="msg-bubble">${m.bubble}</div>
        ${m.card || ""}
        <div class="msg-time">${m.time}</div>
      </div>
    </div>`;
}

function scrollBottom() { chatBody.scrollTop = chatBody.scrollHeight; }

function appendMessage(role, bubble, cardHTML) {
  const conv = currentConv();
  const m = { role, bubble, card: cardHTML || null, time: nowTime() };
  conv.messages.push(m);
  conv.updatedAt = Date.now();
  chatBody.firstElementChild.insertAdjacentHTML("beforeend", msgHTML(m));
  scrollBottom();
}

function renderMessages() {
  chatBody.firstElementChild.innerHTML = currentConv().messages.map(msgHTML).join("");
  scrollBottom();
}

/* ----- 会话管理 ----- */
function renderConvList() {
  $("#conv-list").innerHTML = conversations.map(c => `
    <div class="conv-item ${c.id === currentConvId ? "active" : ""}" data-cid="${c.id}">
      <div class="conv-item-title">${escapeHtml(c.title)}</div>
      <div class="conv-item-meta">${Math.max(0, c.messages.length - 1)} 轮对话 · ${fmtConvDate(c.updatedAt)}</div>
      <button class="conv-del" data-del="${c.id}" title="删除对话">✕</button>
    </div>`).join("");
}

function createConversation(persist = true) {
  const conv = {
    id: "c" + Date.now() + Math.random().toString(36).slice(2, 6),
    title: "新对话",
    messages: [{ role: "agent", bubble: WELCOME_TEXT, card: null, time: nowTime() }],
    updatedAt: Date.now(),
  };
  conversations.unshift(conv);
  currentConvId = conv.id;
  renderConvList();
  renderMessages();
  if (persist) persistChat();
  chatInput.focus();
  return conv;
}

function switchConversation(id) {
  if (id === currentConvId) return;
  currentConvId = id;
  renderConvList();
  renderMessages();
  persistChat();
}

function deleteConversation(id) {
  conversations = conversations.filter(c => c.id !== id);
  if (!conversations.length) {
    createConversation();
  } else {
    if (currentConvId === id) {
      currentConvId = conversations[0].id;
      renderMessages();
    }
    renderConvList();
    persistChat();
  }
  toast("对话已删除");
}

function clearCurrentConv() {
  const conv = currentConv();
  conv.messages = [{ role: "agent", bubble: WELCOME_TEXT, card: null, time: nowTime() }];
  conv.title = "新对话";
  conv.updatedAt = Date.now();
  renderMessages();
  renderConvList();
  persistChat();
  toast("对话已清空");
}

function loadChat() {
  try {
    const raw = localStorage.getItem(CONV_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.conversations) && d.conversations.length) {
        conversations = d.conversations;
        currentConvId = conversations.some(c => c.id === d.currentConvId)
          ? d.currentConvId : conversations[0].id;
        renderConvList();
        renderMessages();
        return;
      }
    }
  } catch (e) { /* 数据损坏则重建 */ }
  createConversation(false);
  persistChat();
}

/* ===== 智能体结构化卡片 ===== */
/* 卡片注册表：保存策略时按 data-cid 取回卡片原始数据 */
const CARD_REGISTRY = {};
let cardSeq = 0;

function agentCardHTML(card) {
  const cid = "ac" + ++cardSeq;
  CARD_REGISTRY[cid] = card;
  const head = `
    <div class="agent-card-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 L7 12 L11 15 L15 6 L18 10 L21 4"/></svg>
      <span class="ac-title">${card.title}</span><span class="tag">${card.tag}</span>
    </div>`;

  let body = "";
  if (card.type === "backtest") {
    body = `
      ${perfChartBlock(card.curve, card.benchCurve, card.benchName)}
      <div class="backtest-grid">
        ${card.metrics.map(m => `
          <div class="bt-item"><div class="bt-label">${m.label}</div>
          <div class="bt-val ${m.cls}">${m.value}</div></div>`).join("")}
      </div>
      <div class="agent-card-text">${card.note}</div>
      <div class="btp-title">回测参数（悬停查看口径）</div>
      ${btParamsHTML()}`;
  } else if (card.type === "report") {
    body = `
      <div class="btp-title">因子配置</div>
      <div class="factor-weights" style="margin-bottom:14px">
        ${card.factors.map(f => `
          <div class="factor-weight-row">
            <span>${f.name}</span>
            <div class="fw-bar"><i style="width:${f.weight}%"></i></div>
            <span class="fw-val">${f.weight}%</span>
          </div>`).join("")}
      </div>
      ${perfChartBlock(card.curve, card.benchCurve, card.benchName)}
      <div class="backtest-grid">
        ${card.metrics.map(m => `
          <div class="bt-item"><div class="bt-label">${m.label}</div>
          <div class="bt-val ${m.cls}">${m.value}</div></div>`).join("")}
      </div>
      <div class="btp-title">回测参数（悬停查看口径）</div>
      ${btParamsHTML()}
      ${card.note ? `<div class="agent-card-text" style="margin:12px 0 0">${card.note}</div>` : ""}`;
  } else {
    if (card.factors) {
      body += `
        <div class="factor-weights">
          ${card.factors.map(f => `
            <div class="factor-weight-row">
              <span>${f.name}</span>
              <div class="fw-bar"><i style="width:${f.weight}%"></i></div>
              <span class="fw-val">${f.weight}%</span>
            </div>`).join("")}
        </div>`;
    }
    if (card.stocks && card.stocks.length) {
      body += `
        <table class="mini-table">
          <tr><th>股票</th><th>综合得分</th><th>${card.stocks[0].weight != null ? "建议权重" : "PE分位"}</th></tr>
          ${card.stocks.map(s => `
            <tr>
              <td>${s.name}<span class="stock-code">${s.code}</span></td>
              <td><span class="score-pill">${s.score.toFixed(1)}</span></td>
              <td>${s.weight != null ? s.weight + "%" : "&lt; 30%"}</td>
            </tr>`).join("")}
        </table>`;
    }
    if (card.note) body += `<div class="agent-card-text" style="margin:12px 0 0">${card.note}</div>`;
  }

  const actions = card.type === "backtest"
    ? `<button class="btn btn-primary btn-sm" data-act="save-backtest">生成完整报告</button>
       <button class="btn btn-ghost btn-sm" data-act="ask-optimize">请求优化建议</button>`
    : card.type === "report"
    ? `<button class="btn btn-primary btn-sm" data-act="save-strategy">保存为我的策略</button>
       <button class="btn btn-ghost btn-sm" data-act="ask-optimize">请求优化建议</button>`
    : `<button class="btn btn-primary btn-sm" data-act="save-strategy">保存为我的策略</button>
       <button class="btn btn-ghost btn-sm" data-act="ask-backtest">帮我回测</button>`;

  return `<div class="agent-card" data-cid="${cid}">${head}<div class="agent-card-body">${body}</div>
    <div class="agent-card-actions">${actions}</div></div>`;
}

/* 卡片按钮事件（事件委托，消息重渲染后依然有效） */
chatBody.addEventListener("click", e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "save-strategy") {
    if (!btn.disabled) saveStrategyFromChat(btn);
  } else if (act === "ask-backtest") {
    appendMessage("user", "帮我回测上面这个策略");
    agentRespond();
  } else if (act === "ask-optimize") {
    appendMessage("user", "请求优化建议");
    agentRespond();
  } else if (act === "save-backtest") {
    btn.disabled = true;
    btn.textContent = "已生成 ✓";
    toast("完整回测报告已保存到「我的策略」");
    gotoPageBtnPulse();
  }
});

function gotoPageBtnPulse() {
  const badge = $("#nav-strategy-count");
  badge.style.transform = "scale(1.25)";
  setTimeout(() => (badge.style.transform = ""), 300);
}

/* 从会话卡片保存策略：优先使用报告卡片自带的回测数据 */
function saveStrategyFromChat(btn) {
  const cardEl = btn.closest(".agent-card");
  const card = CARD_REGISTRY[cardEl.dataset.cid] || {};
  const factors = [...cardEl.querySelectorAll(".factor-weight-row")].map(r => ({
    name: r.firstElementChild.textContent.trim(),
    weight: parseInt(r.querySelector(".fw-val").textContent),
  }));
  const stocks = [...cardEl.querySelectorAll(".mini-table tbody tr, .mini-table tr")].slice(1).map(tr => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 3) return null;
    return {
      code: tds[0].querySelector(".stock-code").textContent,
      name: tds[0].childNodes[0].textContent.trim(),
      score: parseFloat(tds[1].textContent),
      weight: parseFloat(tds[2].textContent) || 5,
      change: +(Math.random() * 3 - 1).toFixed(2),
    };
  }).filter(Boolean);

  const curve = card.curve || Array.from({ length: 30 }, (_, i) =>
    +(100 + i * 0.5 + Math.sin(i / 3) * 1.5 + (Math.random() - 0.4) * 2).toFixed(1));
  const m = card.rawMetrics || { annual: 15.2, drawdown: -10.4, sharpe: 1.47, winRate: 61.0 };

  // 标题提取：新卡片用 .ac-title，旧消息兜底取头部文本节点
  const headEl = cardEl.querySelector(".agent-card-head");
  const name = (headEl.querySelector(".ac-title")?.textContent.trim()
    || [...headEl.childNodes].filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim()).find(Boolean)
    || "未命名策略").replace(/\s*·\s*(回测报告|策略框架|参考框架)$/, "");

  STRATEGIES.push({
    id: "s" + (STRATEGIES.length + 1) + Date.now(),
    name,
    status: "running",
    universe: card.universe || "沪深300 + 中证500",
    rebalance: card.rebalance || "每月调仓",
    benchmark: card.benchName || "沪深300指数",
    updatedAt: new Date().toISOString().slice(5, 10),
    factors,
    metrics: { ...m },
    curve,
    benchCurve: card.benchCurve || mkBench(curve),
    holdings: stocks,
  });
  btn.disabled = true;
  btn.textContent = "已保存 ✓";
  renderStrategies();
  toast("策略已保存，可在「我的策略」中查看");
}

/* 智能体回复：带最近几轮上下文做关键词匹配（多轮对话） */
function findReply(text) {
  const hit = AGENT_REPLIES.find(r => r.match.some(k => text.includes(k)));
  return hit || buildStrategyReply(text);   // 构建/其它请求 → 策略框架 + 回测报告一体
}

function agentRespond() {
  const convId = currentConvId;

  if (currentConvId === convId) {
    chatBody.firstElementChild.insertAdjacentHTML("beforeend", `
      <div class="msg agent"><div class="msg-avatar">${AGENT_SVG}</div>
      <div class="msg-content"><div class="msg-bubble">
        <div class="typing"><i></i><i></i><i></i></div>
      </div></div></div>`);
    scrollBottom();
  }

  setTimeout(() => {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;   // 会话已被删除
    const context = conv.messages.filter(m => m.role === "user").slice(-3).map(m => m.bubble).join(" ");
    const reply = findReply(context);
    const cardHTML = agentCardHTML(reply.card);

    if (currentConvId === convId) {
      const typingEl = chatBody.firstElementChild.lastElementChild;
      if (typingEl && typingEl.querySelector(".typing")) typingEl.remove();
      appendMessage("agent", reply.text, cardHTML);
    } else {
      // 用户已切走：只写入数据，不改动当前屏幕
      conv.messages.push({ role: "agent", bubble: reply.text, card: cardHTML, time: nowTime() });
      conv.updatedAt = Date.now();
      renderConvList();
    }
    persistChat();
  }, 900);
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  appendMessage("user", escapeHtml(text));
  const conv = currentConv();
  if (conv.title === "新对话") {
    conv.title = text.length > 16 ? text.slice(0, 16) + "…" : text;
    renderConvList();
  }
  persistChat();
  agentRespond();
}

$("#btn-send").addEventListener("click", sendChat);
chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });

$("#btn-clear-chat").addEventListener("click", clearCurrentConv);
$("#btn-new-conv").addEventListener("click", () => createConversation());
$("#btn-new-conv-m").addEventListener("click", () => createConversation());

$("#conv-list").addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) { deleteConversation(del.dataset.del); return; }
  const item = e.target.closest(".conv-item");
  if (item) switchConversation(item.dataset.cid);
});

/* 建议提示词 */
function renderSuggestions() {
  $("#chat-suggestions").innerHTML = CHAT_SUGGESTIONS.map(s =>
    `<button class="suggestion-chip">${s}</button>`).join("");
  $$(".suggestion-chip").forEach(chip =>
    chip.addEventListener("click", () => {
      chatInput.value = chip.textContent;
      chatInput.focus();
    }));
}

/* ==========================================================
   页面2：我的策略
   ========================================================== */
const STATUS_MAP = {
  running: { cls: "status-running", text: "运行中" },
  done:    { cls: "status-done",    text: "回测完成" },
  draft:   { cls: "status-draft",   text: "草稿" },
};

function renderStats() {
  const valid = STRATEGIES.filter(s => s.metrics.annual != null);
  const avg = key => valid.reduce((a, s) => a + s.metrics[key], 0) / (valid.length || 1);
  const running = STRATEGIES.filter(s => s.status === "running").length;
  $("#strategy-stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">策略总数</div>
      <div class="stat-value">${STRATEGIES.length}<small>个</small></div></div>
    <div class="stat-card"><div class="stat-label">运行中</div>
      <div class="stat-value">${running}<small>个</small></div></div>
    <div class="stat-card"><div class="stat-label">平均年化收益</div>
      <div class="stat-value up">${fmtPct(avg("annual"))}</div></div>
    <div class="stat-card"><div class="stat-label">平均夏普比率</div>
      <div class="stat-value">${avg("sharpe").toFixed(2)}</div></div>`;
  $("#nav-strategy-count").textContent = STRATEGIES.length;
}

function strategyCardHTML(s) {
  const st = STATUS_MAP[s.status];
  const m = s.metrics;
  return `
    <div class="card strategy-card" data-id="${s.id}">
      <div class="sc-head">
        <div>
          <div class="sc-name">${s.name}</div>
          <div class="sc-universe">股票池：${s.universe} · ${s.rebalance}</div>
        </div>
        <span class="status-badge ${st.cls}">${st.text}</span>
      </div>
      <div class="sc-factors">
        ${s.factors.map(f => `<span class="factor-tag">${f.name} <b>${f.weight}%</b></span>`).join("")}
      </div>
      <div class="sc-metrics">
        <div class="sc-metric"><div class="m-label">年化收益</div>
          <div class="m-val ${m.annual != null ? upDownCls(m.annual) : ""}">${fmtPct(m.annual)}</div></div>
        <div class="sc-metric"><div class="m-label">最大回撤</div>
          <div class="m-val ${m.drawdown != null ? upDownCls(m.drawdown) : ""}">${fmtPct(m.drawdown)}</div></div>
        <div class="sc-metric"><div class="m-label">夏普比率</div>
          <div class="m-val">${m.sharpe != null ? m.sharpe.toFixed(2) : "—"}</div></div>
        <div class="sc-metric"><div class="m-label">胜率</div>
          <div class="m-val">${m.winRate != null ? m.winRate.toFixed(1) + "%" : "—"}</div></div>
      </div>
      <div class="sc-chart">${sparklineSVG(s.curve)}</div>
      <div class="sc-footer">
        <span class="sc-updated">更新于 ${s.updatedAt}</span>
        <div class="sc-actions">
          <button class="icon-btn" data-op="detail" title="详情">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </button>
          <button class="icon-btn" data-op="backtest" title="重新回测">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <button class="icon-btn" data-op="delete" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function renderStrategies() {
  renderStats();
  $("#strategy-grid").innerHTML = STRATEGIES.map(strategyCardHTML).join("");
}

$("#strategy-grid").addEventListener("click", e => {
  const card = e.target.closest(".strategy-card");
  if (!card) return;
  const s = STRATEGIES.find(x => x.id === card.dataset.id);
  const op = e.target.closest("[data-op]")?.dataset.op;
  if (op === "backtest") { toast(`「${s.name}」已加入回测队列`); return; }
  if (op === "delete") {
    if (confirm(`确定删除策略「${s.name}」吗？此操作不可恢复。`)) {
      STRATEGIES.splice(STRATEGIES.indexOf(s), 1);
      renderStrategies();
      toast("策略已删除");
    }
    return;
  }
  openStrategyModal(s);
});

/* ===== 策略详情弹窗（因子权重可调） ===== */
function closeModal() {
  const mask = $("#modal-root .modal-mask");
  if (mask) mask.remove();
}

function openModal(html) {
  closeModal();
  $("#modal-root").innerHTML = `<div class="modal-mask"><div class="modal">${html}</div></div>`;
  $("#modal-root .modal-mask").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeModal();
  });
}

/* 生成演示持仓（Top K = 50，表格展示前 k 只） */
function genHoldings(k = 10) {
  return [...DEMO_STOCK_POOL].sort(() => Math.random() - 0.5).slice(0, k)
    .map((s, i) => ({
      ...s,
      score: +(94 - i * 1.6 + Math.random()).toFixed(1),
      weight: +Math.max(2.2, 6.2 - i * 0.45 + (Math.random() - 0.5) * 0.6).toFixed(1),
      change: +((Math.random() - 0.45) * 5).toFixed(2),
    }));
}

/* 模拟回测：按当前配置生成演示用的绩效数据（接后端后替换为真实回测） */
function maxDrawdownPct(curve) {
  let peak = curve[0], dd = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, (v / peak - 1) * 100);
  }
  return +dd.toFixed(1);
}

function runMockBacktest(s, force = false) {
  if (s.metrics.annual != null && !force) return;
  const curve = Array.from({ length: 30 }, (_, i) =>
    +(100 + i * (0.5 + Math.random() * 0.5) + Math.sin(i / 3) * 1.5 + (Math.random() - 0.45) * 2.2).toFixed(1));
  const total = curve[curve.length - 1] / 100 - 1;
  s.curve = curve;
  s.benchCurve = mkBench(curve);
  s.metrics = {
    annual: +((Math.pow(1 + total, 1 / 3) - 1) * 100).toFixed(1),
    drawdown: maxDrawdownPct(curve),
    sharpe: +(0.7 + Math.random() * 0.9).toFixed(2),
    winRate: +(52 + Math.random() * 11).toFixed(1),
  };
  if (s.status === "draft") s.status = "done";
  if (force || !s.holdings.length) s.holdings = genHoldings(10);
  s.updatedAt = new Date().toISOString().slice(5, 10);
}

/* 回测报告弹窗 */
function openBacktestReport(s) {
  const m = s.metrics;
  openModal(`
    <div class="modal-head">
      <div class="modal-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        回测报告 · ${s.name}
      </div>
      <button class="icon-btn" data-close>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      ${perfChartBlock(s.curve, s.benchCurve, s.benchmark)}
      <div class="backtest-grid" style="margin-bottom:18px">
        <div class="bt-item"><div class="bt-label">年化收益</div>
          <div class="bt-val ${upDownCls(m.annual)}">${fmtPct(m.annual)}</div></div>
        <div class="bt-item"><div class="bt-label">最大回撤</div>
          <div class="bt-val ${upDownCls(m.drawdown)}">${fmtPct(m.drawdown)}</div></div>
        <div class="bt-item"><div class="bt-label">夏普比率</div>
          <div class="bt-val">${m.sharpe.toFixed(2)}</div></div>
        <div class="bt-item"><div class="bt-label">胜率</div>
          <div class="bt-val">${m.winRate.toFixed(1)}%</div></div>
      </div>
      <div class="detail-section-title" style="margin-bottom:10px">回测参数</div>
      ${btParamsHTML()}
      <div class="agent-card-text" style="margin:10px 0 0">本报告按上方参数口径、基于当前因子权重与「${s.universe}」股票池模拟生成，收益已扣除手续费；历史业绩不代表未来表现。</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>关闭</button>
      <button class="btn btn-primary" data-op="export">导出报告</button>
    </div>`);

  const modal = $("#modal-root .modal");
  modal.addEventListener("click", e => {
    const btn = e.target.closest("[data-op],[data-close]");
    if (!btn) return;
    if (btn.dataset.close) return closeModal();
    if (btn.dataset.op === "export") toast("回测报告已导出（演示）");
  });
}

function openStrategyModal(s) {
  const m = s.metrics;
  openModal(`
    <div class="modal-head">
      <div class="modal-title">${s.name}
        <span class="status-badge ${STATUS_MAP[s.status].cls}">${STATUS_MAP[s.status].text}</span>
      </div>
      <button class="icon-btn" data-close>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="detail-section">
        <div class="detail-section-title">基础配置</div>
        <div class="detail-meta">
          <div class="meta-item"><div class="meta-label">股票池</div><div class="meta-val">${s.universe}</div></div>
          <div class="meta-item"><div class="meta-label">调仓频率</div><div class="meta-val">${s.rebalance}</div></div>
          <div class="meta-item"><div class="meta-label">业绩基准</div><div class="meta-val">${s.benchmark}</div></div>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">因子权重（可拖动调整）</div>
        ${s.factors.map((f, i) => `
          <div class="weight-slider-row">
            <span class="ws-name">${f.name}</span>
            <div class="ws-bar"><i style="width:${f.weight}%"></i></div>
            <input type="range" min="0" max="100" value="${f.weight}" data-fi="${i}">
            <span class="ws-val" data-vi="${i}">${f.weight}%</span>
            <span class="fw-val" style="font-size:11px;color:var(--text-3)"></span>
          </div>`).join("")}
        <div class="weight-total">当前合计 <b>${s.factors.reduce((a, f) => a + f.weight, 0)}%</b> / 100%</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">绩效概览</div>
        ${m.annual != null
          ? perfChartBlock(s.curve, s.benchCurve, s.benchmark)
          : `<div class="agent-card-text" style="margin:4px 0 12px">该策略尚未回测，保存配置后将自动生成回测报告。</div>`}
        <div class="backtest-grid">
          <div class="bt-item"><div class="bt-label">年化收益</div>
            <div class="bt-val ${m.annual != null ? upDownCls(m.annual) : ""}">${fmtPct(m.annual)}</div></div>
          <div class="bt-item"><div class="bt-label">最大回撤</div>
            <div class="bt-val ${m.drawdown != null ? upDownCls(m.drawdown) : ""}">${fmtPct(m.drawdown)}</div></div>
          <div class="bt-item"><div class="bt-label">夏普比率</div>
            <div class="bt-val">${m.sharpe != null ? m.sharpe.toFixed(2) : "—"}</div></div>
          <div class="bt-item"><div class="bt-label">胜率</div>
            <div class="bt-val">${m.winRate != null ? m.winRate.toFixed(1) + "%" : "—"}</div></div>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">当前持仓（展示前 ${Math.max(s.holdings.length, 0)} 只 / Top K = 50）</div>
        ${s.holdings.length ? `
          <table class="mini-table">
            <tr><th>股票</th><th>因子得分</th><th>持仓权重</th><th>今日涨跌</th></tr>
            ${s.holdings.map(h => `
              <tr>
                <td>${h.name}<span class="stock-code">${h.code}</span></td>
                <td><span class="score-pill">${h.score.toFixed(1)}</span></td>
                <td>${h.weight.toFixed(1)}%</td>
                <td class="${upDownCls(h.change)}">${h.change > 0 ? "+" : ""}${h.change.toFixed(2)}%</td>
              </tr>`).join("")}
          </table>` : `<div class="agent-card-text">暂无持仓，完成回测后按最新因子得分自动生成。</div>`}
      </div>
      <div class="detail-section" style="margin-bottom:0">
        <div class="detail-section-title">回测参数</div>
        ${btParamsHTML()}
        <div class="agent-card-text" style="margin:8px 0 0">以上为本次回测采用的口径，悬停参数可查看说明；调整因子权重并保存后将按新配置重新回测。</div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-op="delete">删除策略</button>
      <button class="btn btn-ghost" data-op="rebacktest">重新回测</button>
      <button class="btn btn-primary" data-op="save">保存并生成回测报告</button>
    </div>`);

  const modal = $("#modal-root .modal");

  /* 权重滑杆联动 */
  modal.querySelectorAll("input[type=range]").forEach(r => {
    r.addEventListener("input", () => {
      const i = +r.dataset.fi;
      s.factors[i].weight = +r.value;
      modal.querySelector(`[data-vi="${i}"]`).textContent = r.value + "%";
      r.previousElementSibling.firstElementChild.style.width = r.value + "%";
      const total = s.factors.reduce((a, f) => a + f.weight, 0);
      const totalEl = modal.querySelector(".weight-total");
      totalEl.innerHTML = `当前合计 <b>${total}%</b> / 100%`;
      totalEl.classList.toggle("error", total !== 100);
    });
  });

  modal.addEventListener("click", e => {
    const btn = e.target.closest("[data-op],[data-close]");
    if (!btn) return;
    if (btn.dataset.close) return closeModal();
    const op = btn.dataset.op;
    if (op === "save") {
      if (s.factors.reduce((a, f) => a + f.weight, 0) !== 100)
        return toast("因子权重合计需等于 100%");
      runMockBacktest(s, true);
      renderStrategies();
      closeModal();
      openBacktestReport(s);
      toast("因子权重已保存，已按新配置完成回测");
    } else if (op === "rebacktest") {
      runMockBacktest(s, true);
      renderStrategies();
      closeModal();
      openBacktestReport(s);
      toast("回测完成");
    } else if (op === "delete") {
      if (confirm(`确定删除策略「${s.name}」吗？此操作不可恢复。`)) {
        STRATEGIES.splice(STRATEGIES.indexOf(s), 1);
        renderStrategies();
        closeModal();
        toast("策略已删除");
      }
    }
  });
}

/* ===== 新建策略弹窗 ===== */
$("#btn-new-strategy").addEventListener("click", () => {
  openModal(`
    <div class="modal-head">
      <div class="modal-title">新建策略</div>
      <button class="icon-btn" data-close>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="detail-section">
        <div class="detail-section-title">策略名称</div>
        <input type="text" id="ns-name" placeholder="例如：大盘价值轮动策略"
          style="width:100%;border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:14px;outline:none">
      </div>
      <div class="detail-section">
        <div class="detail-section-title">股票池与调仓</div>
        <div class="detail-meta" style="grid-template-columns:1fr 1fr">
          <div class="meta-item" style="padding:8px 14px">
            <div class="meta-label">股票池</div>
            <select id="ns-universe" style="width:100%;border:none;background:transparent;font-size:14px;outline:none;font-weight:600">
              <option>沪深300</option><option>中证500</option><option>中证800</option>
              <option>中证1000</option><option>全市场（剔除ST）</option>
            </select>
          </div>
          <div class="meta-item" style="padding:8px 14px">
            <div class="meta-label">调仓频率</div>
            <select id="ns-rebalance" style="width:100%;border:none;background:transparent;font-size:14px;outline:none;font-weight:600">
              <option>每周调仓</option><option selected>每月调仓</option><option>每季度调仓</option>
            </select>
          </div>
        </div>
      </div>
      <div class="detail-section" style="margin-bottom:0">
        <div class="detail-section-title">选择因子（点击勾选）</div>
        <div id="ns-factors" style="display:flex;flex-wrap:wrap;gap:8px">
          ${FACTOR_LIB.map((f, i) => `
            <label class="factor-tag" data-fi="${i}" style="cursor:pointer;user-select:none;padding:7px 13px;font-size:12px">
              <input type="checkbox" style="accent-color:var(--primary);margin-right:5px;vertical-align:-1px">${f.name}
            </label>`).join("")}
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>取消</button>
      <button class="btn btn-primary" id="ns-create">创建策略</button>
    </div>`);

  const modal = $("#modal-root .modal");
  modal.querySelector("#ns-name").focus();
  modal.addEventListener("click", e => {
    if (e.target.closest("[data-close]")) closeModal();
    if (e.target.closest("#ns-create")) {
      const name = modal.querySelector("#ns-name").value.trim();
      const checked = [...modal.querySelectorAll("#ns-factors input:checked")];
      if (!name) return toast("请填写策略名称");
      if (!checked.length) return toast("请至少选择一个因子");
      const per = Math.floor(100 / checked.length);
      STRATEGIES.unshift({
        id: "s" + Date.now(),
        name,
        status: "draft",
        universe: modal.querySelector("#ns-universe").value,
        rebalance: modal.querySelector("#ns-rebalance").value,
        benchmark: "沪深300指数",
        updatedAt: new Date().toISOString().slice(5, 10),
        factors: checked.map((c, i) => ({
          name: FACTOR_LIB[+c.closest("[data-fi]").dataset.fi].name.replace("因子", ""),
          weight: i === 0 ? 100 - per * (checked.length - 1) : per,
        })),
        metrics: { annual: null, drawdown: null, sharpe: null, winRate: null },
        curve: Array(30).fill(100),
        benchCurve: Array(30).fill(100),
        holdings: [],
      });
      renderStrategies();
      closeModal();
      toast("策略已创建（草稿），去对话页让智能体完善它吧");
    }
  });
});

document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ==========================================================
   页面3：个人中心
   ========================================================== */
const SETTING_ICONS = {
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
  database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
};

function renderProfile() {
  $("#user-card").innerHTML = `
    <div class="uc-top">
      <div class="avatar uc-avatar">陈</div>
      <div>
        <div class="uc-name">${PROFILE.name}</div>
        <div class="uc-desc">${PROFILE.org}</div>
      </div>
      <span class="uc-plan">${PROFILE.plan}</span>
    </div>
    <div class="uc-divider"></div>
    <div class="uc-rows">
      <div class="uc-row"><span class="k">注册时间</span><span class="v">${PROFILE.registerDate}</span></div>
      <div class="uc-row"><span class="k">最近登录</span><span class="v">${PROFILE.lastLogin}</span></div>
      <div class="uc-row"><span class="k">默认业绩基准</span><span class="v">沪深300指数</span></div>
      <div class="uc-row"><span class="k">风控等级</span><span class="v">稳健型（回撤 ≤ 15%）</span></div>
    </div>`;

  $("#radar-chart").innerHTML = radarSVG(PROFILE.radar);
  $("#radar-legend").innerHTML =
    `<span><i></i>偏好强度（0-100）</span>`;

  $("#profile-settings").innerHTML = PROFILE.settings.map(s => `
    <div class="setting-row">
      <div class="setting-left">
        ${SETTING_ICONS[s.icon]}
        <div class="setting-info">
          <div class="s-title">${s.title}</div>
          <div class="s-desc">${s.desc}</div>
        </div>
      </div>
      ${s.on === null
        ? `<span style="font-size:13px;color:var(--text-3)">${s.value}</span>`
        : `<label class="switch"><input type="checkbox" ${s.on ? "checked" : ""} data-key="${s.key}"><span class="track"></span></label>`}
    </div>`).join("");

  $("#profile-settings").addEventListener("change", e => {
    if (e.target.matches("[data-key]")) {
      const item = PROFILE.settings.find(x => x.key === e.target.dataset.key);
      item.on = e.target.checked;
      toast(`「${item.title}」已${e.target.checked ? "开启" : "关闭"}`);
    }
  });
}

/* ===== 初始化 ===== */
renderSuggestions();
loadChat();
renderStrategies();
renderProfile();
