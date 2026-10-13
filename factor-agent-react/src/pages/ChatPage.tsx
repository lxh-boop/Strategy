import { useEffect, useRef, useState } from "react";
import type { AgentCard, BacktestCard, ChatMessage, Conversation, MetricItem } from "../types";
import { CHAT_SUGGESTIONS } from "../data/mock";
import { fmtConvDate } from "../utils/format";
import { PerfChart } from "../components/charts";
import { ConfirmModal, Modal, ParamsBlock } from "../components/ui";
import { MiniMarkdown } from "../components/markdown";
import { IconClose, IconLogo, IconPlus, IconSend, IconStop } from "../components/icons";

/* ----- 确认门文案解析：格式由后端 formatConfirmText 生成（稳定契约）。
   首行为"将按以下参数执行(策略|等权)回测："，其后每行"- 标签：值"；
   命中 = 当前智能体在等用户确认回测参数，前端以弹窗呈现结构化参数与操作按钮。
   标签清单由后端决定（新引擎含排序因子方向/权重、过滤/卖出规则），前端通用渲染 ----- */
function parseConfirmGate(bubble: string): { label: string; value: string }[] | null {
  if (!/^将按以下参数执行(策略|等权)回测：/.test(bubble)) return null;
  const rows = bubble
    .split("\n")
    .filter(l => l.startsWith("- "))
    .map(l => {
      const idx = l.indexOf("：");
      return idx > 2 ? { label: l.slice(2, idx), value: l.slice(idx + 1) } : null;
    })
    .filter((r): r is { label: string; value: string } => r !== null);
  return rows.length ? rows : null;
}

/* ----- 优化建议邀请识别：模型给出多方案建议并邀请"授权调优"
   （结尾话术由系统提示词回复规则锚定，规则匹配替代自然语言猜测） ----- */
function parseOptimizeInvite(bubble: string): boolean {
  return bubble.includes("授权调优") && /建议|方向|对比/.test(bubble);
}

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

function AgentCardView({ card, saved, onSaveBacktest, onAskBacktest, onAskOptimize, onGotoStrategies }: {
  card: AgentCard;
  saved: string[];
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
    /* 历史报告卡只展示：草稿保存链已下线，策略统一由回测卡片（带可复现配置）保存 */
    actions = <button className="btn btn-ghost btn-sm" data-act="ask-optimize" onClick={onAskOptimize}>请求优化建议</button>;
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
        {/* 月度归因 + 交易明细：策略回测（日频事件内核）新产出；旧等权卡片无这两个字段 */}
        {card.monthly && card.monthly.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">月度归因</div>
            <div className="monthly-strip">
              {card.monthly.map(m => (
                <span key={m.month} className={`monthly-chip ${m.pct >= 0 ? "up" : "down"}`}
                  title={`${m.month}：${m.pct > 0 ? "+" : ""}${m.pct}%`}>
                  {m.month.slice(2)} {m.pct > 0 ? "+" : ""}{m.pct}%
                </span>
              ))}
            </div>
          </div>
        )}
        {card.trades && card.trades.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">交易明细（最近 {card.trades.length} 笔）</div>
            <div className="trade-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>日期</th><th>证券</th><th>方向</th>
                    <th className="num">价格</th><th className="num">股数</th>
                    <th className="num">金额</th><th className="num">费用</th><th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {card.trades.map((t, i) => (
                    <tr key={i}>
                      <td>{String(t.date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}</td>
                      <td>{t.code}</td>
                      <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "买入" : "卖出"}</td>
                      <td className="num">{t.price}</td>
                      <td className="num">{t.shares.toLocaleString("zh-CN")}</td>
                      <td className="num">{Math.round(t.amount).toLocaleString("zh-CN")}</td>
                      <td className="num">{Math.round(t.fee).toLocaleString("zh-CN")}</td>
                      <td>{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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

function MessageRow({ m, userInitial, saved, onSaveBacktest, onAskBacktest, onAskOptimize, onGotoStrategies }: {
  m: ChatMessage;
  userInitial: string;
  saved: string[];
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
        {/* 智能体回复走轻量 Markdown 渲染（粗体/列表/表格），用户输入保持纯文本 */}
        <div className="msg-bubble">
          {isUser ? m.bubble : <MiniMarkdown text={m.bubble} />}
        </div>
        {m.card && (
          <AgentCardView
            card={m.card}
            saved={saved}
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
  /** API-27：把 TOOL-C07 回测卡片保存为策略（服务端重跑真引擎） */
  onSaveBacktest: (card: BacktestCard) => Promise<void>;
  onGotoStrategies: () => void;
  /** 「去对话创建」预填输入框的内容（消费后回调置空，防重复灌入） */
  draftInput?: string | null;
  onDraftConsumed?: () => void;
}) {
  const {
    conversations, currentId, typingId, live, loading, savedCardIds, userNickname,
    onCreate, onSwitch, onDelete, onClear, onSubmit, onStop, onSaveBacktest, onGotoStrategies,
    draftInput, onDraftConsumed,
  } = props;
  const current = conversations.find(c => c.id === currentId) ?? conversations[0];
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const typingHere = current ? typingId === current.id : false;
  const liveSteps = typingHere && live && live.convId === current?.id ? live.steps : undefined;
  const userInitial = userNickname.slice(0, 1) || "友";
  /* 确认门/优化建议弹窗关闭标记（新消息到达/切换会话时自动重置） */
  const [gateClosed, setGateClosed] = useState(false);
  const [optimizeClosed, setOptimizeClosed] = useState(false);
  const [gateText, setGateText] = useState("");
  const [optimizeText, setOptimizeText] = useState("");
  /* 确认门：最后一条是智能体的参数提案且未关闭 → 弹窗（确认执行/授权调优/取消） */
  const lastMessage = current && current.messages.length ? current.messages[current.messages.length - 1] : null;
  /* 弹窗已打扰记忆：按"会话+末条消息"记指纹，同一条消息只弹一次——
     上面的布尔标记会被"新消息/切会话"重置，导致挂在会话末尾的旧建议回复反复弹窗
     （2026-10-13：RSI 回测回复结尾带"授权调优"邀请，一整天每次进会话都跳）。
     指纹不随重置消失：关过的消息永不再弹，新回复指纹变化才重新触发 */
  const lastKey = current && lastMessage ? `${current.id}:${current.messages.length}:${lastMessage.bubble.slice(0, 80)}` : "";
  const dismissedRef = useRef<Set<string>>(new Set());
  const gateParams =
    !typingHere && lastMessage && lastMessage.role === "agent" ? parseConfirmGate(lastMessage.bubble) : null;
  const gateVisible = !!gateParams && !gateClosed && !dismissedRef.current.has(`gate:${lastKey}`) && !loading;
  const closeGate = () => {
    setGateClosed(true);
    dismissedRef.current.add(`gate:${lastKey}`);
  };
  const gateAct = (text: string) => {
    closeGate();
    onSubmit(text);
  };
  /* 优化建议弹窗：模型刚给出多方案建议并邀请授权调优（文案由回复规则锚定，规则匹配无歧义） */
  const optimizeInvite =
    !gateParams && !typingHere && lastMessage && lastMessage.role === "agent" && parseOptimizeInvite(lastMessage.bubble);
  const optimizeVisible = optimizeInvite && !optimizeClosed && !dismissedRef.current.has(`opt:${lastKey}`) && !loading;
  const closeOptimize = () => {
    setOptimizeClosed(true);
    dismissedRef.current.add(`opt:${lastKey}`);
  };
  const optimizeAct = (text: string) => {
    closeOptimize();
    onSubmit(text);
  };
  useEffect(() => {
    setGateClosed(false);
    setOptimizeClosed(false);
    setGateText("");
    setOptimizeText("");
  }, [current?.id, current?.messages.length]);

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

  /* 「去对话创建」等入口的预填草稿：灌入输入框并聚焦；会话未就绪（无输入框）时保留，
     current 就绪后依赖变化重触发补灌。消费后回调置空，避免切会话/重渲染重复灌入 */
  const convReady = current != null;
  useEffect(() => {
    if (!draftInput || !convReady) return;
    const el = inputRef.current;
    if (!el) return;
    el.value = draftInput;
    autoResize();
    el.focus();
    el.setSelectionRange(draftInput.length, draftInput.length);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftInput, convReady]);

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

      {gateVisible && gateParams && (
        <Modal onClose={closeGate} ariaLabel="回测参数确认">
          <div className="modal-head">
            <div className="modal-title">回测参数确认</div>
            <button className="icon-btn" aria-label="关闭" onClick={closeGate}><IconClose /></button>
          </div>
          <div className="modal-body">
            <div className="agent-card-text" style={{ margin: "0 0 12px" }}>智能体已就绪，将按以下参数执行策略回测：</div>
            <div className="gate-params">
              {gateParams.map(p => (
                <div className="gate-param" key={p.label}>
                  <span className="gate-param-label">{p.label}</span>
                  <span className="gate-param-val">{p.value}</span>
                </div>
              ))}
            </div>
            <div className="gate-hint">
              「确认执行」立即开始回测；「授权调优」由智能体按建议连续多组自动对比择优。
              如需调整参数或暂不回测，在下方直接输入。
            </div>
            <div className="gate-alt">
              <input className="gate-alt-input" value={gateText} aria-label="输入其他要求"
                placeholder="如：改成月频、区间用近一年、先不回测…"
                onChange={e => setGateText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && gateText.trim()) gateAct(gateText.trim()); }} />
              <button className="btn btn-sm btn-ghost" onClick={() => gateText.trim() && gateAct(gateText.trim())}>发送</button>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => gateAct("授权调优")}>授权调优</button>
            <button className="btn btn-primary" onClick={() => gateAct("确认")}>确认执行</button>
          </div>
        </Modal>
      )}
      {optimizeVisible && (
        <Modal onClose={closeOptimize} ariaLabel="优化建议">
          <div className="modal-head">
            <div className="modal-title">优化建议</div>
            <button className="icon-btn" aria-label="关闭" onClick={closeOptimize}><IconClose /></button>
          </div>
          <div className="modal-body">
            <div className="agent-card-text" style={{ margin: "0 0 12px" }}>
              智能体给出了优化建议，原文如下（也可在下方直接输入其他要求）：
            </div>
            {lastMessage && (
              <div className="optimize-quote">{lastMessage.bubble}</div>
            )}
            <div className="optimize-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => optimizeAct("确认")}>按建议执行下一轮</button>
              <button className="btn btn-primary" onClick={() => optimizeAct("授权调优")}>授权调优·连续多组对比</button>
            </div>
            <div className="gate-alt">
              <input className="gate-alt-input" value={optimizeText} aria-label="输入其他要求"
                placeholder="或直接输入其他要求…"
                onChange={e => setOptimizeText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && optimizeText.trim()) optimizeAct(optimizeText.trim()); }} />
              <button className="btn btn-sm btn-ghost" onClick={() => optimizeText.trim() && optimizeAct(optimizeText.trim())}>发送</button>
            </div>
          </div>
        </Modal>
      )}
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
