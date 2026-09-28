import { useEffect, useRef } from "react";
import type { AgentCard, ChatMessage, Conversation, MetricItem, ReportCard } from "../types";
import { CHAT_SUGGESTIONS } from "../data/mock";
import { fmtConvDate } from "../utils/format";
import { PerfChart } from "../components/charts";
import { ParamsBlock } from "../components/ui";
import {
  IconAttach, IconClose, IconLogo, IconPlus, IconSend,
} from "../components/icons";

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

function AgentCardView({ card, saved, onSave, onAskBacktest, onAskOptimize, notify }: {
  card: AgentCard;
  saved: string[];
  onSave: (c: ReportCard) => void;
  onAskBacktest: () => void;
  onAskOptimize: () => void;
  notify: (m: string) => void;
}) {
  const isSaved = card.id != null && saved.includes(card.id);

  let actions;
  if (card.type === "backtest") {
    actions = (
      <>
        <button className="btn btn-primary btn-sm" data-act="save-backtest" onClick={() => notify("完整回测报告已保存到「我的策略」")}>生成完整报告</button>
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
        <PerfChart curve={card.curve} benchCurve={card.benchCurve} benchName={card.benchName} />
        <MetricGrid metrics={card.metrics} />
        <div className="agent-card-text">{card.note}</div>
        <ParamsBlock />
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
              <th>股票</th><th>综合得分</th>
              <th>{card.stocks[0]?.weight != null ? "建议权重" : "PE分位"}</th>
            </tr>
          </thead>
          <tbody>
            {card.stocks.map(s => (
              <tr key={s.code}>
                <td>{s.name}<span className="stock-code">{s.code}</span></td>
                <td><span className="score-pill">{s.score.toFixed(1)}</span></td>
                <td>{s.weight != null ? s.weight + "%" : "< 30%"}</td>
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

function MessageRow({ m, saved, onSave, onAskBacktest, onAskOptimize, notify }: {
  m: ChatMessage;
  saved: string[];
  onSave: (c: ReportCard) => void;
  onAskBacktest: () => void;
  onAskOptimize: () => void;
  notify: (m: string) => void;
}) {
  const isUser = m.role === "user";
  return (
    <div className={`msg ${m.role}`}>
      <div className="msg-avatar">{isUser ? "陈" : <IconLogo size={18} />}</div>
      <div className="msg-content">
        <div className="msg-bubble">{m.bubble}</div>
        {m.card && (
          <AgentCardView
            card={m.card}
            saved={saved}
            onSave={onSave}
            onAskBacktest={onAskBacktest}
            onAskOptimize={onAskOptimize}
            notify={notify}
          />
        )}
        <div className="msg-time">{m.time}</div>
      </div>
    </div>
  );
}

function TypingRow() {
  return (
    <div className="msg agent">
      <div className="msg-avatar"><IconLogo size={18} /></div>
      <div className="msg-content">
        <div className="msg-bubble">
          <div className="typing"><i /><i /><i /></div>
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
  loading: boolean;
  savedCardIds: string[];
  notify: (m: string) => void;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: (id: string) => void;
  onSubmit: (text: string) => void;
  onSaveStrategy: (c: ReportCard) => void;
  onGotoStrategies: () => void;
}) {
  const {
    conversations, currentId, typingId, loading, savedCardIds, notify,
    onCreate, onSwitch, onDelete, onClear, onSubmit, onSaveStrategy, onGotoStrategies,
  } = props;
  const current = conversations.find(c => c.id === currentId) ?? conversations[0];
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const typingHere = current ? typingId === current.id : false;

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.messages.length, typingHere]);

  const send = () => {
    const text = inputRef.current?.value.trim();
    if (!text) return;
    if (inputRef.current) inputRef.current.value = "";
    onSubmit(text);
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
              onClick={() => onSwitch(c.id)}>
              <div className="conv-item-title">{c.title}</div>
              <div className="conv-item-meta">
                {Math.max(0, c.messages.length - 1)} 轮对话 · {fmtConvDate(c.updatedAt)}
              </div>
              <button className="conv-del" title="删除对话"
                onClick={e => { e.stopPropagation(); onDelete(c.id); }}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <div className="chat-agent">
            <div className="chat-agent-avatar"><IconLogo size={20} /></div>
            <div>
              <div className="chat-agent-name">因子智投 · 选股智能体</div>
              <div className="chat-agent-desc">多因子建模 / 智能对话 / 回测分析</div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button className="btn btn-ghost btn-sm btn-new-conv-m" onClick={onCreate}><IconPlus />新建对话</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onClear(current.id)}>
              <IconClose />清空对话
            </button>
            <button className="btn btn-primary btn-sm" onClick={onGotoStrategies}>查看我的策略</button>
          </div>
        </header>

        <div className="chat-body" ref={bodyRef}>
          <div className="chat-body-inner">
            {current.messages.map((m, i) => (
              <MessageRow key={i} m={m} saved={savedCardIds} notify={notify}
                onSave={onSaveStrategy}
                onAskBacktest={() => onSubmit("帮我回测上面这个策略")}
                onAskOptimize={() => onSubmit("请求优化建议")}
              />
            ))}
            {typingHere && <TypingRow />}
          </div>
        </div>

        <footer className="chat-input-wrap">
          <div className="chat-suggestions">
            {CHAT_SUGGESTIONS.map(s => (
              <button className="suggestion-chip" key={s}
                onClick={() => { if (inputRef.current) { inputRef.current.value = s; inputRef.current.focus(); } }}>
                {s}
              </button>
            ))}
          </div>
          <div className="chat-input-box">
            <button className="icon-btn" title="上传数据文件"><IconAttach /></button>
            <input ref={inputRef} placeholder="向智能体描述你的选股需求，如：帮我构建一个低波动+高股息的防御策略…"
              onKeyDown={e => { if (e.key === "Enter") send(); }} />
            <button className="btn btn-primary btn-send" onClick={send}>
              发送 <IconSend />
            </button>
          </div>
          <div className="chat-disclaimer">内容由 AI 生成，仅供研究参考，不构成投资建议</div>
        </footer>
      </div>
    </section>
  );
}
