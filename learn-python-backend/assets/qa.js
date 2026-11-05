/* ============================================================
   learn-python-backend 面试卡片组件 — 零依赖 vanilla JS（配合 assets/qa.css）
   用法：
     <div data-qa-toolbar></div>              工具条：统计 / 只看待练 / 全部展开 / 清空自评
     <article class="qa" data-qa-id="l1-a1">  id 全站唯一，自评记录按它存
       <header class="qa-head">
         <span class="qa-tag">必考</span>      进阶用 class="qa-tag adv"，场景用 "qa-tag scene"
         <h3 class="qa-q">题目</h3>
       </header>
       <div class="qa-body">考察点 / 30 秒回答 / 展开 / 追问 / 加分项 / 踩坑</div>
     </article>
   行为：答案默认收起，先口述再展开；展开后三档自评，存 localStorage；
         「答上了」超过 7 天重新算作待练（间隔复习）。
   脚本没能跑完时 <html> 不会带上 .qa-ready，答案全部可见（降级为阅读模式）。
   ============================================================ */
(function () {
  "use strict";

  var PREFIX = "learn-python:qa:";
  var DAY = 86400000;
  var REVIEW_AFTER = 7 * DAY;
  var LABEL = { ok: "答上了", half: "答一半", miss: "没答上" };
  var REVEAL_TEXT = "先口述，再展开对照";

  var cards = Array.prototype.slice.call(document.querySelectorAll(".qa[data-qa-id]"));
  if (!cards.length) return;

  function load(id) {
    try {
      var rec = JSON.parse(localStorage.getItem(PREFIX + id));
      return rec && LABEL[rec.r] ? rec : null;
    } catch (e) {
      return null;
    }
  }

  function save(id, r) {
    try {
      localStorage.setItem(PREFIX + id, JSON.stringify({ r: r, t: Date.now() }));
    } catch (e) {}
  }

  function forget(id) {
    try {
      localStorage.removeItem(PREFIX + id);
    } catch (e) {}
  }

  function isDue(rec) {
    return !rec || rec.r !== "ok" || Date.now() - rec.t > REVIEW_AFTER;
  }

  function ago(t) {
    var d = Math.floor((Date.now() - t) / DAY);
    return d <= 0 ? "今天" : d + " 天前";
  }

  var filterOn = false;
  var allOpen = false;

  var bar = document.querySelector("[data-qa-toolbar]");
  if (!bar) {
    bar = document.createElement("div");
    cards[0].parentNode.insertBefore(bar, cards[0]);
  }
  bar.className = "qa-toolbar";
  bar.innerHTML =
    '<span class="qa-stats"></span>' +
    '<button type="button" data-act="filter" aria-pressed="false">只看待练</button>' +
    '<button type="button" data-act="expand">全部展开</button>' +
    '<button type="button" data-act="reset">清空自评</button>';
  var stats = bar.querySelector(".qa-stats");

  function setOpen(card, open) {
    card.classList.toggle("open", open);
    card.querySelector(".qa-reveal").textContent = open ? "收起答案" : REVEAL_TEXT;
  }

  function paint(card) {
    var rec = load(card.getAttribute("data-qa-id"));
    var meta = card.querySelector(".qa-meta");
    if (!rec) {
      meta.textContent = "未练";
    } else {
      meta.textContent =
        "上次：" + LABEL[rec.r] + " · " + ago(rec.t) + (rec.r === "ok" && isDue(rec) ? " · 该复习了" : "");
    }
    meta.setAttribute("data-r", rec ? rec.r : "none");
    card.querySelectorAll(".qa-rate button").forEach(function (b) {
      b.classList.toggle("on", !!rec && b.getAttribute("data-r") === rec.r);
    });
  }

  function refresh() {
    var n = { ok: 0, half: 0, miss: 0, none: 0 };
    var pending = 0;
    cards.forEach(function (c) {
      var rec = load(c.getAttribute("data-qa-id"));
      n[rec ? rec.r : "none"]++;
      var due = isDue(rec);
      if (due) pending++;
      c.classList.toggle("qa-filtered", filterOn && !due);
    });
    stats.textContent =
      "本页 " + cards.length + " 题 · 答上 " + n.ok + " · 答一半 " + n.half +
      " · 没答上 " + n.miss + " · 未练 " + n.none + " ｜ 待练 " + pending;
  }

  cards.forEach(function (card) {
    var id = card.getAttribute("data-qa-id");
    if (!card.id) card.id = id;

    var meta = document.createElement("span");
    meta.className = "qa-meta";
    card.querySelector(".qa-head").appendChild(meta);

    var actions = document.createElement("div");
    actions.className = "qa-actions";
    actions.innerHTML =
      '<button type="button" class="qa-reveal">' + REVEAL_TEXT + "</button>" +
      '<span class="qa-rate">' +
      '<button type="button" data-r="ok">答上了</button>' +
      '<button type="button" data-r="half">答一半</button>' +
      '<button type="button" data-r="miss">没答上</button>' +
      "</span>";
    card.appendChild(actions);

    actions.querySelector(".qa-reveal").addEventListener("click", function () {
      setOpen(card, !card.classList.contains("open"));
    });
    actions.querySelectorAll(".qa-rate button").forEach(function (b) {
      b.addEventListener("click", function () {
        save(id, b.getAttribute("data-r"));
        paint(card);
        refresh();
      });
    });

    paint(card);
  });

  bar.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    if (act === "filter") {
      filterOn = !filterOn;
      btn.setAttribute("aria-pressed", String(filterOn));
      refresh();
    } else if (act === "expand") {
      allOpen = !allOpen;
      cards.forEach(function (c) {
        setOpen(c, allOpen);
      });
      btn.textContent = allOpen ? "全部收起" : "全部展开";
    } else if (act === "reset") {
      if (!window.confirm("清空本页所有自评记录？")) return;
      cards.forEach(function (c) {
        forget(c.getAttribute("data-qa-id"));
        paint(c);
      });
      refresh();
    }
  });

  refresh();
  document.documentElement.classList.add("qa-ready");
})();
