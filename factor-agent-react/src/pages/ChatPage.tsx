import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AgentCard, BacktestCard, ChatMessage, Conversation } from "../types";
import { CHAT_SUGGESTIONS } from "../data/mock";
import { fmtYmd, fmtConvDate } from "../utils/format";
import { IcChart, PerfChart, Sparkline } from "../components/charts";
import { ConfirmModal, MetricGrid, Modal, ParamsBlock } from "../components/ui";
import { AttributionTables } from "../components/AttributionTables";
import { PeriodHoldingsTable } from "../components/HoldingsTable";
import { MiniMarkdown } from "../components/markdown";
import { IconClose, IconLogo, IconPlus, IconSend, IconStop } from "../components/icons";
import type { ConfirmGatePending } from "../hooks/useConversations";

/* ----- 智能体卡片 ----- */

/* 收益视图切换按钮（分段累计 / 多空净值）的内联样式 */
const viewBtnStyle = (active: boolean): CSSProperties => ({
  fontSize: 11, padding: "1px 8px", marginRight: 4, cursor: "pointer", borderRadius: 6,
  border: "1px solid var(--tile-border)", background: active ? "var(--tile-border)" : "transparent",
  color: "var(--text-2)",
});

function AgentCardView({ card, saved, onSaveBacktest, onAskOptimize, onGotoStrategies, onAskAttribution }: {
  card: AgentCard;
  saved: string[];
  onSaveBacktest: (c: BacktestCard) => Promise<void>;
  onAskOptimize: () => void;
  onGotoStrategies: () => void;
  onAskAttribution: (cardRef: string) => void;
}) {
  const isSaved = card.id != null && saved.includes(card.id);
  const [savingBacktest, setSavingBacktest] = useState(false);
  /* 排名分析收益视图：false=分段累计表（默认，兼容旧卡）/ true=多空虚拟净值曲线 */
  const [lsView, setLsView] = useState(false);

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
        {card.cardRef && (
          <button className="btn btn-ghost btn-sm" data-act="ask-attribution"
            onClick={() => onAskAttribution(card.cardRef!)}>归因分析</button>
        )}
      </>
    );
  }

  /* 卡片类型分派：backtest 是唯一卡片类型（对话真引擎产物）。
     历史上的 report / stocks 卡（演示时代的报告卡/筛股卡）2026-10-13 已随演示链
     全量下线：产出方删除、类型定义删除、库中零存量（32 张卡 100% backtest） */
  let body;
  if (card.type === "backtest") {
    /* 卡片只保留最近一期调仓（最新一期期末持仓 + 调仓指令）；全部周期与逐笔明细不上屏 */
    const latestPeriod = card.periodHoldings && card.periodHoldings.length > 0
      ? card.periodHoldings[card.periodHoldings.length - 1]
      : undefined;
    body = (
      <>
        <PerfChart curve={card.curve} benchCurve={card.benchCurve} benchName={card.benchName} dates={card.dates} />
        <MetricGrid metrics={card.metrics} />
        <div className="agent-card-text">{card.note}</div>
        {/* 本次回测真实参数；旧卡片无 params 时回退策略配置项 */}
        <ParamsBlock items={card.params} />
        {/* 仓位分布 + 持股占比 + 踏空归因：大盘择时启用时的新产出 */}
        {card.positionDist && card.positionDist.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">仓位分布（择时）</div>
            <div className="monthly-strip">
              {card.positionDist.map(b => (
                <span key={b.label} className="monthly-chip">{b.label} · {b.days}日</span>
              ))}
              {card.holdingDaysPct !== undefined && (
                <span className="monthly-chip">持股时间 {card.holdingDaysPct}%</span>
              )}
            </div>
            {card.missedRallies && card.missedRallies.length > 0 && (
              <div className="agent-card-text" style={{ marginTop: 6 }}>
                踏空归因（择时期间错过的基准大涨日）：{card.missedRallies.map(m => `${m.date}（基准+${m.pct}%，仓位${m.exposure}%）`).join("、")}
              </div>
            )}
          </div>
        )}
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
        {/* 历史持仓详情（全部周期表）按产品决定下线，数据仍由后端产出只是不上屏 */}
        {/* 最近一期调仓：最新一期期末持仓（对标果仁「每日选股」的最新期） */}
        {latestPeriod && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">
              最近一期持仓（第 {latestPeriod.seq} 期 · {fmtYmd(latestPeriod.startDate)} ~ {fmtYmd(latestPeriod.endDate)}）
            </div>
            <div className="trade-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>证券</th><th className="num">股数</th><th className="num">期末收盘</th>
                    <th className="num">进入基准</th><th className="num">期间收益%</th><th className="num">权重%</th>
                  </tr>
                </thead>
                <tbody>
                  {latestPeriod.holdings.map(h => (
                    <tr key={h.code}>
                      <td>{h.code}</td>
                      <td className="num">{h.shares.toLocaleString("zh-CN")}</td>
                      <td className="num">{h.closePrice}</td>
                      <td className="num">{h.entryPrice}</td>
                      <td className={`num ${h.periodReturnPct >= 0 ? "up" : "down"}`}>{h.periodReturnPct > 0 ? "+" : ""}{h.periodReturnPct}%</td>
                      <td className="num">{h.weightPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {card.latestOrders && card.latestOrders.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="btp-title">最新调仓指令（最后一期全部成交）</div>
                <div className="trade-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr><th>日期</th><th>证券</th><th>方向</th><th className="num">数量</th><th>原因</th></tr>
                    </thead>
                    <tbody>
                      {card.latestOrders.map((t, i) => (
                        <tr key={i}>
                          <td>{fmtYmd(t.date)}</td>
                          <td>{t.code}</td>
                          <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "买入" : "卖出"}</td>
                          <td className="num">{t.shares.toLocaleString("zh-CN")}</td>
                          <td>{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {card.recentSold && card.recentSold.length > 0 && (
                  <div className="agent-card-text" style={{ marginTop: 6 }}>最近卖出：{card.recentSold.join("、")}</div>
                )}
              </div>
            )}
          </div>
        )}
        {/* 交易明细（最近 N 笔）按产品决定下线，数据仍由后端产出只是不上屏 */}
      </>
    );
  }

  if (card.type === "attribution") {
    return (
      <>
        <div className="agent-card-text">{card.sourceCard} · 生成于 {card.generatedAt} · 全口径 = 已实现 FIFO + 期末浮动</div>
        <AttributionTables card={card} />
      </>
    );
  }

  if (card.type === "rank_analysis") {
    const dirText = card.factor.direction === 1 ? "值大优" : "值小优";
    body = (
      <>
        <div className="agent-card-text">
          {card.factor.table}.{card.factor.field}（{dirText}）· 分 {card.segmentCount} 段 ·
          每 {card.intervalDays} 个交易日 · {card.periodCount} 期
        </div>
        <MetricGrid metrics={[
          { label: "IC 均值", value: card.icMean !== undefined ? String(card.icMean) : "—" },
          { label: "IC 为正概率", value: card.icPositiveProb !== undefined ? `${card.icPositiveProb}%` : "—" },
          { label: "因子 IR", value: card.icIR !== undefined ? String(card.icIR) : "—" },
          { label: "排列单调性 r²", value: String(card.monotonicityR2) },
        ]} />
        {card.icSeries.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">IC 序列</div>
            <IcChart series={card.icSeries} />
          </div>
        )}
        {card.icDecay && card.icDecay.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">IC 衰减（按持有期，交易日）</div>
            <div className="monthly-strip">
              {card.icDecay.map(d => (
                <span key={d.lag} className={`monthly-chip ${d.ic >= 0 ? "up" : "down"}`} title={`持有 ${d.lag} 个交易日的平均 IC`}>
                  {d.lag}日 {d.ic > 0 ? "+" : ""}{d.ic}
                </span>
              ))}
            </div>
          </div>
        )}
        {card.segmentMeanReturnPct.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="btp-title">
              收益视图（段 1 = 因子最优先段）
              {card.longShortSeries && card.longShortSeries.length > 1 && (
                <span style={{ marginLeft: 8 }}>
                  <button aria-pressed={!lsView} style={viewBtnStyle(!lsView)} onClick={() => setLsView(false)}>分段累计</button>
                  <button aria-pressed={lsView} style={viewBtnStyle(lsView)} onClick={() => setLsView(true)}>多空净值</button>
                </span>
              )}
            </div>
            {lsView && card.longShortSeries ? (
              <>
                <Sparkline data={card.longShortSeries.map(s => s.nav)} width={640} height={110} />
                <div className="agent-card-text">
                  多空虚拟净值（段 1 做多 − 末段做空，起点 100，无费用）：期末{" "}
                  {card.longShortSeries[card.longShortSeries.length - 1].nav}
                </div>
              </>
            ) : (
              <div className="trade-scroll">
                <table className="mini-table">
                  <thead>
                    <tr><th>段</th><th className="num">平均单期收益%</th><th className="num">区间累计收益%</th></tr>
                  </thead>
                  <tbody>
                    {card.segmentMeanReturnPct.map((mean, i) => (
                      <tr key={i}>
                        <td>段 {i + 1}{i === 0 ? "（最优先）" : i === card.segmentMeanReturnPct.length - 1 ? "（最末段）" : ""}</td>
                        <td className={`num ${mean >= 0 ? "up" : "down"}`}>{mean > 0 ? "+" : ""}{mean}%</td>
                        <td className={`num ${card.segmentCumulativePct[i] >= 0 ? "up" : "down"}`}>
                          {card.segmentCumulativePct[i] > 0 ? "+" : ""}{card.segmentCumulativePct[i]}%
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>多空价差（段1−末段）</td>
                      <td className={`num ${card.longShortSpreadPct >= 0 ? "up" : "down"}`} colSpan={2}>
                        {card.longShortSpreadPct > 0 ? "+" : ""}{card.longShortSpreadPct}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  if (card.type === "correlation") {
    /* 色阶：正相关红、负相关蓝，|r| 越大底色越深；null（样本不足）灰字 */
    const cellStyle = (v: number | null): CSSProperties => {
      if (v === null) return { color: "var(--text-3)" };
      const pct = Math.round(Math.min(1, Math.abs(v)) * 62);
      return { background: `color-mix(in srgb, ${v >= 0 ? "var(--up)" : "var(--down)"} ${pct}%, transparent)` };
    };
    const shortName = (f: string) => f.split(".")[1] ?? f;
    body = (
      <>
        <div className="agent-card-text">采样 {card.periodCount} 期 · 单元格 = 两因子截面秩相关均值（逐期公共股票）</div>
        <div className="trade-scroll">
          <table className="mini-table corr-matrix">
            <thead>
              <tr><th />
                {card.factors.map(f => <th key={f}>{shortName(f)}</th>)}
              </tr>
            </thead>
            <tbody>
              {card.factors.map((rowF, i) => (
                <tr key={rowF}>
                  <td>{shortName(rowF)}</td>
                  {card.matrix[i].map((v, j) => (
                    <td key={j} className="num" style={cellStyle(v)}>{v === null ? "—" : v.toFixed(2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="agent-card-text">|相关系数| ≥ 0.7 视为高相关（冗余），组合时建议二选一</div>
      </>
    );
  }

  if (card.type === "screen") {
    body = (
      <>
        <div className="agent-card-text">
          {fmtYmd(card.date)} · 过滤前 {card.rawPoolSize} 只 →
          条件存活 {card.survivedCount} 只 · 入选前 {card.stocks.length} 只
          {card.usedDefaultSort ? " · 排序缺省（默认 20 日动量，值大优）" : ""}
        </div>
        <div className="trade-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th>#</th><th>证券</th><th className="num">综合分</th>
                {card.sortFactors.map(f => (
                  <th key={`${f.table}.${f.field}`} className="num">
                    {f.field}{f.direction === -1 ? "(小值优)" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.stocks.map((s, i) => (
                <tr key={s.code}>
                  <td>{i + 1}</td>
                  <td>{s.code}</td>
                  <td className="num">{s.score}</td>
                  {s.factorValues.map((v, j) => (
                    <td key={j} className="num">{v === null ? "—" : v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="agent-card-text">入选口径与回测信号一致（过滤→排序→前 N）；历史数据回放，不构成投资建议</div>
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

function MessageRow({ m, userInitial, saved, onSaveBacktest, onAskOptimize, onGotoStrategies, onAskAttribution }: {
  m: ChatMessage;
  userInitial: string;
  saved: string[];
  onSaveBacktest: (c: BacktestCard) => Promise<void>;
  onAskOptimize: () => void;
  onGotoStrategies: () => void;
  onAskAttribution: (cardRef: string) => void;
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
            onAskOptimize={onAskOptimize}
            onGotoStrategies={onGotoStrategies}
            onAskAttribution={onAskAttribution}
          />
        )}
        <div className="msg-time">{m.time}</div>
      </div>
    </div>
  );
}

function TypingRow({ steps, note }: { steps?: { stage: string; ok?: boolean; detail?: string }[]; note?: string }) {
  return (
    <div className="msg agent">
      <div className="msg-avatar" aria-hidden="true"><IconLogo size={18} /></div>
      <div className="msg-content">
        <div className="msg-bubble" role="status" aria-label="智能体正在回复">
          <div className="typing" aria-hidden="true"><i /><i /><i /></div>
          {note && <div className="chat-note">{note}</div>}
          {steps && steps.length > 0 && (
            <div className="chat-steps">
              {steps.map((s, i) => (
                <span className={`chat-step ${s.ok === true ? "ok" : s.ok === false ? "bad" : ""}`} key={i}>
                  {s.stage}
                  {s.detail ? ` · ${s.detail}` : ""}
                  <em>{s.ok === true ? "✓" : s.ok === false ? "✕" : "…"}</em>
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
  /** 在途消息的流式过程步骤（SSE 节点级事件，见 useConversations 的 LiveProgress） */
  live?: { convId: string; steps: { stage: string; ok?: boolean; detail?: string }[] } | null;
  /** 在跑轮次（后端仍在执行、尚未落库的会话，刷新后经运行状态接口恢复） */
  backendBusyId?: string | null;
  /** 确认门挂起（confirm_pending 事件落地态，见 useConversations 的 ConfirmGatePending） */
  confirmGate?: ConfirmGatePending | null;
  loading: boolean;
  savedCardIds: string[];
  /** 当前登录用户昵称首字：用户消息头像（替代旧硬编码人设） */
  userNickname: string;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: (id: string) => void;
  onSubmit: (text: string) => void;
  /** 归因分析按钮：按卡片编号发起归因分析请求（走对话流，GLM 调工具） */
  onAskAttribution: (cardRef: string) => void;
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
    conversations, currentId, typingId, live, confirmGate, loading, backendBusyId,
    savedCardIds, userNickname,
    onCreate, onSwitch, onDelete, onClear, onSubmit, onStop, onSaveBacktest, onGotoStrategies,
    draftInput, onDraftConsumed, onAskAttribution,
  } = props;
  const current = conversations.find(c => c.id === currentId) ?? conversations[0];
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const typingHere = current ? typingId === current.id : false;
  const liveSteps = typingHere && live && live.convId === current?.id ? live.steps : undefined;
  /* 在跑轮次占位：本轮无本地流（刷新后恢复），只有静态提示、无步骤、停止按钮不可用 */
  const backendHere = !typingHere && current ? backendBusyId === current.id : false;
  const userInitial = userNickname.slice(0, 1) || "友";
  /* 确认门弹窗：唯一依据 = confirm_pending 事件（后端 confirm 节点 interrupt 挂起时经 SSE 发来）。
     不再对末条消息做文本反推——挂尾巴的旧提案/邀请话术刷新后一律静默。
     关闭按对象引用记 dismissed：新事件是新对象、重新弹出；同会话新一轮发送时 hook 已清挂起态 */
  const [dismissedGate, setDismissedGate] = useState<ConfirmGatePending | null>(null);
  const [gateText, setGateText] = useState("");
  const gate = confirmGate && confirmGate.convId === current?.id ? confirmGate : null;
  const gateVisible = !!gate && gate !== dismissedGate && !typingHere;
  const closeGate = () => {
    setDismissedGate(gate);
    setGateText("");
  };
  const gateAct = (text: string) => {
    closeGate();
    onSubmit(text);
  };
  useEffect(() => {
    setGateText("");
  }, [current?.id]);

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
                              onAskOptimize={() => onSubmit("请求优化建议")}
                onGotoStrategies={onGotoStrategies}
                onAskAttribution={onAskAttribution}
              />
            ))}
            {(typingHere || backendHere) && (
              <TypingRow
                steps={liveSteps}
                note={backendHere ? "上一条消息仍在后台执行中，结果即将出现在会话里…" : undefined}
              />
            )}
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

      {gateVisible && gate && (
        <Modal onClose={closeGate} ariaLabel="参数确认">
          <div className="modal-head">
            <div className="modal-title">参数确认</div>
            <button className="icon-btn" aria-label="关闭" onClick={closeGate}><IconClose /></button>
          </div>
          <div className="modal-body">
            <div className="agent-card-text" style={{ margin: "0 0 12px" }}>智能体已就绪，将按以下参数执行：</div>
            <div className="gate-params">
              {Object.entries(gate.params).map(([label, value]) => (
                <div className="gate-param" key={label}>
                  <span className="gate-param-label">{label}</span>
                  <span className="gate-param-val">{value}</span>
                </div>
              ))}
            </div>
            <div className="gate-hint">
              「确认执行」立即开始；「授权调优」由智能体按建议连续多组自动对比择优。
              如需调整参数或暂不执行，在下方直接输入。
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
