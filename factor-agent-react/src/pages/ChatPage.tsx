import { useEffect, useRef, useState } from "react";
import type { AgentCard, BacktestCard, ChatMessage, Conversation, MetricItem, ReportCard } from "../types";
import { CHAT_SUGGESTIONS } from "../data/mock";
import { fmtConvDate } from "../utils/format";
import { PerfChart } from "../components/charts";
import { ConfirmModal, ParamsBlock } from "../components/ui";
import { IconClose, IconLogo, IconPlus, IconSend, IconStop } from "../components/icons";

/* ----- 智能体卡片 ----- */

function MetricGrid({ metrics }: { metrics: MetricItem[] }) {
  return (
    <div className="backtest-grid">
      {metrics.map(m => (
        <div className="bt-item" key={m.label}>
          <div className="bt-label">{m.label}</div>
          <div className={`bt-val ${m.cls ?? ""}`}>{m.value}</div>
        </div>
      ))}
    </div>
  );
}

function AgentCardView({ card, saved, onSave, onSaveBacktest, onAskBacktest, onAskOptimize, onGotoStrategies }: {
  card: AgentCard;
  saved: string[];
  onSave: (c: ReportCard) => void;
  onSaveBacktest: (c: BacktestCard) => Promise<void>;
  onAskBacktest: () => void;
  onAskOptimize: () => void;
  onGotoStrategies: () => void;
}) {
  const isSaved = card.id != null && saved.includes(card.id);
  const [savingBacktest, setSavingBacktest] = useState(false);

  let actions;
  if (card.type === "backtest") {
    actions = (
      <>
        {card.config && (
          <button className="btn btn-primary btn-sm" data-act="save-backtest"
            disabled={isSaved || savingBacktest}
            onClick={() => { setSavingBacktest(true); onSaveBacktest(card).finally(() => setSavingBacktest(false)); }}>
            {isSaved ? "已保存 ✓" : savingBacktest ? "保存中…" : "保存为我的策略"}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" data-act="goto-strategies" onClick={onGotoStrategies}>查看我的策略</button>
        <button className="btn btn-ghost btn-sm" data-act="ask-optimize" onClick={onAskOptimize}>请求优化建议</button>
      </>
    );
  } else if (card.type === "report") {
    actions = (
      <>
        <button className="btn btn-primary btn-sm" data-act="save-strategy" disabled={isSaved} onClick={() => onSave(card)}>
          {isSaved ? "已保存 ✓" : "保存为我的策略"}
        </button>
        <button className="btn btn-ghost btn-sm" data-act="ask-optimize" onClick={onAskOptimize}>请求优化建议</button>
      </>
    );
  } else {
    actions = <button className="btn btn-ghost btn-sm" data-act="ask-backtest" onClick={onAskBacktest}>帮我回测这个结果</button>;
  }

  let body;
  if (card.type === "backtest") {
    body = (
      <>
        <PerfChart curve={card.curve} benchCurve={card.benchCurve} benchName={card.benchName} dates={card.dates} />
        <MetricGrid metrics={card.metrics} />
        <div className="agent-card-text">{card.note}</div>
        {/* 本次回测真实参数；旧卡片无 params 时回退策略配置项 */}
        <ParamsBlock items={card.params} />
      </>
    );
  } else if (card.type === "report") {
    body = (
      <>
        <div className="btp-title">因子配置</div>
        <div className="factor-weights" style={{ marginBottom: 14 }}>
          {card.factors.map(f => (
            <div className="factor-weight-row" key={f.name}>
              <span>{f.name}</span>
              <div className="fw-bar"><i style={{ width: `${f.weight}%` }} /></div>
              <span className="fw-val">{f.weight}%</span>
            </div>
          ))}
        </div>
        <PerfChart curve={card.curve} benchCurve={card.benchCurve} benchName={card.benchName} />
        <MetricGrid metrics={card.metrics} />
        <ParamsBlock />
        {card.note && <div className="agent-card-text" style={{ margin: "12px 0 0" }}>{card.note}</div>}
      </>
    );
  } else {
    body = (
      <>
        <table className="mini-table">
          <thead>
            <tr>
              <th>股票</th><th className="num">综合得分</th>
              <th className="num">{card.stocks[0]?.weight != null ? "建议权重" : "PE分位"}</th>
            </tr>
          </thead>
          <tbody>
            {card.stocks.map(s => (
              <tr key={s.code}>
                <td>{s.name}<span className="stock-code">{s.code}</span></td>
                <td className="num"><span className="score-pill">{s.score.toFixed(1)}</span></td>
                <td className="num">{s.weight != null ? s.weight + "%" : "< 30%"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {card.note && <div className="agent-card-text" style={{ margin: "12px 0 0" }}>{card.note}</div>}
      </>
    );
  }

  return (
    <div className="agent-card">
      <div className="agent-card-head">
        <IconLogo size={16} />
        <span className="ac-title">{card.title}</span>
        <span className="tag">{card.tag}</span>
      </div>
      <div className="agent-card-body">{body}</div>
      <div className="agent-card-actions">{actions}</div>
    </div>
  );
}

/* ----- 消息 ----- */

function MessageRow({ m, userInitial, saved, onSave, onSaveBacktest, onAskBacktest, onAskOptimize, onGotoStrategies }: {
  m: ChatMessage;
  userInitial: string;
  saved: string[];
  onSave: (c: ReportCard) => void;
  onSaveBacktest: (c: BacktestCard) => Promise<void>;
  onAskBacktest: () => void;
  onAskOptimize: () => void;
  onGotoStrategies: () => void;
}) {
  const isUser = m.role === "user";
  return (
    <div className={`msg ${m.role}`}>
      <div className="msg-avatar" aria-hidden="true">{isUser ? userInitial : <IconLogo size={18} />}</div>
      <div className="msg-content">
        <div className="msg-bubble">{m.bubble}</div>
        {m.card && (
          <AgentCardView
            card={m.card}
            saved={saved}
            onSave={onSave}
            onSaveBacktest={onSaveBacktest}
            onAskBacktest={onAskBacktest}
            onAskOptimize={onAskOptimize}
            onGotoStrategies={onGotoStrategies}
          />
        )}
        <div className="msg-time">{m.time}</div>
      </div>
    </div>
  );
}

function TypingRow({ steps }: { steps?: { stage: string; ok?: boolean }[] }) {
  return (
    <div className="msg agent">
      <div className="msg-avatar" aria-hidden="true"><IconLogo size={18} /></div>
      <div className="msg-content">
        <div className="msg-bubble" role="status" aria-label="智能体正在回复">
          <div className="typing" aria-hidden="true"><i /><i /><i /></div>
          {steps && steps.length > 0 && (
            <div className="chat-steps">
              {steps.map((s, i) => (
                <span className={`chat-step ${s.ok === true ? "ok" : s.ok === false ? "bad" : ""}`} key={i}>
                  {s.stage}<em>{s.ok === true ? "✓" : s.ok === false ? "✕" : "…"}</em>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----- 页面 ----- */

export function ChatPage(props: {
  conversations: Conversation[];
  currentId: string;
  typingId: string | null;
  /** 在途消息的流式过程步骤（SSE 节点级事件，见 useConversations） */
  live?: { convId: string; steps: { stage: string; ok?: boolean }[] } | null;
  loading: boolean;
  savedCardIds: string[];
  /** 当前登录用户昵称首字：用户消息头像（替代旧硬编码人设） */
  userNickname: string;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: (id: string) => void;
  onSubmit: (text: string) => void;
  /** 停止当前会话的流式生成（消息已送达后端） */
  onStop: (convId: string) => void;
  onSaveStrategy: (c: ReportCard) => void;
  /** API-27：把 TOOL-C07 回测卡片保存为策略（服务端重跑真引擎） */
  onSaveBacktest: (card: BacktestCard) => Promise<void>;
  onGotoStrategies: () => void;
}) {
  const {
    conversations, currentId, typingId, live, loading, savedCardIds, userNickname,
    onCreate, onSwitch, onDelete, onClear, onSubmit, onStop, onSaveStrategy, onSaveBacktest, onGotoStrategies,
  } = props;
  const current = conversations.find(c => c.id === currentId) ?? conversations[0];
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const typingHere = current ? typingId === current.id : false;
  const liveSteps = typingHere && live && live.convId === current?.id ? live.steps : undefined;
  const userInitial = userNickname.slice(0, 1) || "友";

  /* 破坏性操作确认（删除/清空对话），全站统一 ConfirmModal */
  const [confirm, setConfirm] = useState<null | { kind: "delete" | "clear"; title: string }>(null);
  /* 生成中再点发送的阻塞提示（输入草稿保留不丢） */
  const [hint, setHint] = useState("");
  const hintTimer = useRef<number | undefined>(undefined);
  const showHint = (msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(""), 2600);
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.messages.length, typingHere, liveSteps?.length]);

  const send = () => {
    const el = inputRef.current;
    const text = el?.value.trim();
    if (!text) return;
    if (typingHere) {
      /* 生成中不丢草稿：文字留在输入框，提示可停止或稍候 */
      showHint("当前回复生成中，可点击「停止」结束本轮，或稍候再发送");
      return;
    }
    if (el) { el.value = ""; resetHeight(el); }
    onSubmit(text);
  };

  /** 输入框随内容自增长：一行起，最多约 7 行后内部滚动 */
  const autoResize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 196) + "px";
  };
  const resetHeight = (el: HTMLTextAreaElement) => { el.style.height = "auto"; };

  const confirmAction = () => {
    if (!confirm || !current) return;
    if (confirm.kind === "delete") onDelete(current.id);
    else onClear(current.id);
    setConfirm(null);
  };

  if (!current) {
    /* 会话尚未从后端加载完成（或加载失败）时的占位 */
    return (
      <section id="page-chat" className="page active">
        <div className="chat-body">
          <div className="chat-body-inner">
            <div className="agent-card-text" style={{ textAlign: "center", marginTop: 80 }}>
              {loading ? "正在从后端加载会话…" : "暂无会话，请点击「新建对话」"}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="page-chat" className="page active">
      {/* 会话列表侧栏 */}
      <aside className="conv-panel">
        <button className="btn btn-primary conv-new-btn" onClick={onCreate}>
          <IconPlus />新建对话
        </button>
        <div className="conv-list">
          {conversations.map(c => (
            <div key={c.id}
              className={`conv-item ${c.id === currentId ? "active" : ""}`}
              role="button" tabIndex={0}
              aria-current={c.id === currentId ? "true" : undefined}
              onClick={() => onSwitch(c.id)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSwitch(c.id); } }}>
              <div className="conv-item-title">{c.title}</div>
              <div className="conv-item-meta">
                {Math.max(0, c.messages.length - 1)} 轮对话 · {fmtConvDate(c.updatedAt)}
              </div>
              <button className="conv-del" title="删除对话" aria-label={`删除对话「${c.title}」`}
                onClick={e => { e.stopPropagation(); setConfirm({ kind: "delete", title: c.title }); }}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <div className="chat-agent">
            <div className="chat-agent-avatar" aria-hidden="true"><IconLogo size={20} /></div>
            <div>
              <div className="chat-agent-name">因子智投 · 选股智能体</div>
              <div className="chat-agent-desc">多因子建模 / 智能对话 / 回测分析</div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button className="btn btn-ghost btn-sm btn-new-conv-m" onClick={onCreate}><IconPlus />新建对话</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ kind: "clear", title: current.title })}>
              <IconClose />清空对话
            </button>
            <button className="btn btn-primary btn-sm" onClick={onGotoStrategies}>查看我的策略</button>
          </div>
        </header>

        <div className="chat-body" ref={bodyRef}>
          <div className="chat-body-inner">
            {current.messages.map((m, i) => (
              <MessageRow key={i} m={m} userInitial={userInitial} saved={savedCardIds}
                onSave={onSaveStrategy}
                onSaveBacktest={onSaveBacktest}
                onAskBacktest={() => onSubmit("帮我回测上面这个策略")}
                onAskOptimize={() => onSubmit("请求优化建议")}
                onGotoStrategies={onGotoStrategies}
              />
            ))}
            {typingHere && <TypingRow steps={liveSteps} />}
          </div>
        </div>

        <footer className="chat-input-wrap">
          <div className="chat-suggestions">
            {CHAT_SUGGESTIONS.map(s => (
              <button className="suggestion-chip" key={s}
                onClick={() => {
                  if (!inputRef.current) return;
                  inputRef.current.value = s;
                  autoResize();
                  inputRef.current.focus();
                  inputRef.current.setSelectionRange(s.length, s.length);
                }}>
                {s}
              </button>
            ))}
          </div>
          <div className="chat-input-box">
            <textarea ref={inputRef} rows={1} aria-label="输入消息"
              placeholder="向智能体描述你的选股需求，如：帮我构建一个低波动+高股息的防御策略…"
              onKeyDown={e => {
                /* Enter 发送；Shift+Enter 换行（多行输入的标准交互） */
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              onInput={autoResize}
            />
            {typingHere ? (
              <button className="btn btn-ghost btn-send" onClick={() => onStop(current.id)}>
                <IconStop />停止
              </button>
            ) : (
              <button className="btn btn-primary btn-send" onClick={send}>
                发送 <IconSend />
              </button>
            )}
          </div>
          {hint && <div className="chat-hint" role="status">{hint}</div>}
          <div className="chat-disclaimer">内容由 AI 生成，仅供研究参考，不构成投资建议</div>
        </footer>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.kind === "delete" ? "删除对话" : "清空对话"}
          message={confirm.kind === "delete"
            ? `确定删除对话「${confirm.title}」吗？删除后不可恢复。`
            : `确定清空对话「${confirm.title}」的全部消息吗？清空后不可恢复。`}
          confirmText={confirm.kind === "delete" ? "删除" : "清空"}
          onConfirm={confirmAction}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
