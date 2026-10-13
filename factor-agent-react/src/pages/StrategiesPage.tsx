import { useState } from "react";
import type { Strategy } from "../types";
import { useConfig } from "../config";
import { fmtPct, upDownCls } from "../utils/format";
import { PerfChart, Sparkline } from "../components/charts";
import { ConfirmModal, MetricGrid, Modal, ParamsBlock } from "../components/ui";
import { IconClose, IconInfo, IconLogo, IconPlay, IconPlus, IconTrash } from "../components/icons";

const STATUS: Record<Strategy["status"], { cls: string; text: string }> = {
  running: { cls: "status-running", text: "运行中" },
  done: { cls: "status-done", text: "回测完成" },
  draft: { cls: "status-draft", text: "草稿" },
};

/* ----- 策略卡片 ----- */

function StrategyCard({ s, onOpen, onBacktest, onDelete }: {
  s: Strategy;
  onOpen: () => void;
  onBacktest: () => Promise<void>;
  onDelete: () => void;
}) {
  const st = STATUS[s.status];
  const m = s.metrics;
  const [btBusy, setBtBusy] = useState(false);
  const rebacktest = async () => {
    if (btBusy) return;
    setBtBusy(true);
    try { await onBacktest(); } finally { setBtBusy(false); }
  };

  return (
    <div className="card strategy-card" role="button" tabIndex={0}
      aria-label={`打开策略「${s.name}」详情`}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
      <div className="sc-head">
        <div>
          <div className="sc-name">{s.name}</div>
          <div className="sc-universe">股票池：{s.universe} · {s.rebalance}</div>
        </div>
        <span className={`status-badge ${st.cls}`}>{st.text}</span>
      </div>
      <div className="sc-factors">
        {s.factors.map(f => <span className="factor-tag" key={f.name}>{f.name} <b>{f.weight}%</b></span>)}
      </div>
      <div className="sc-metrics">
        <div className="sc-metric">
          <div className="m-label">年化收益</div>
          <div className={`m-val ${m ? upDownCls(m.annual) : ""}`}>{fmtPct(m?.annual ?? null)}</div>
        </div>
        <div className="sc-metric">
          <div className="m-label">最大回撤</div>
          <div className={`m-val ${m ? upDownCls(m.drawdown) : ""}`}>{fmtPct(m?.drawdown ?? null)}</div>
        </div>
        <div className="sc-metric"><div className="m-label">夏普比率</div><div className="m-val">{m ? m.sharpe.toFixed(2) : "—"}</div></div>
        <div className="sc-metric"><div className="m-label">胜率</div><div className="m-val">{m ? m.winRate.toFixed(1) + "%" : "—"}</div></div>
      </div>
      <div className="sc-chart"><Sparkline data={s.curve} /></div>
      <div className="sc-footer">
        <span className="sc-updated">更新于 {s.updatedAt}</span>
        <div className="sc-actions">
          <button className="icon-btn" title="详情" aria-label={`查看「${s.name}」详情`}
            onClick={e => { e.stopPropagation(); onOpen(); }}><IconInfo /></button>
          <button className="icon-btn" title={btBusy ? "回测进行中…" : "重新回测"} aria-label={`重新回测「${s.name}」`}
            disabled={btBusy} onClick={e => { e.stopPropagation(); void rebacktest(); }}><IconPlay /></button>
          <button className="icon-btn icon-btn-danger" title="删除" aria-label={`删除策略「${s.name}」`}
            onClick={e => { e.stopPropagation(); onDelete(); }}><IconTrash /></button>
        </div>
      </div>
    </div>
  );
}

/* ----- 策略详情弹窗（只读展示 + 重跑；创建/调参统一在对话完成） ----- */

function StrategyDetailModal({ s, onClose, onRebacktest, onDelete }: {
  s: Strategy;
  onClose: () => void;
  onRebacktest: () => Promise<void>;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const m = s.metrics;

  /* 重新回测触发一次完整回测：await 期间按钮禁用，防重复提交 */
  const retest = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRebacktest(); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} ariaLabel={`策略详情：${s.name}`}>
      <div className="modal-head">
        <div className="modal-title">
          {s.name}
          <span className={`status-badge ${STATUS[s.status].cls}`}>{STATUS[s.status].text}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn icon-btn-danger" title="删除策略" aria-label={`删除策略「${s.name}」`}
            disabled={busy} onClick={onDelete}><IconTrash /></button>
          <button className="icon-btn" title="关闭" aria-label="关闭" onClick={onClose}><IconClose /></button>
        </div>
      </div>
      <div className="modal-body">
        <div className="detail-section">
          <div className="detail-section-title">基础配置</div>
          <div className="detail-meta">
            <div className="meta-item"><div className="meta-label">股票池</div><div className="meta-val">{s.universe}</div></div>
            <div className="meta-item"><div className="meta-label">调仓频率</div><div className="meta-val">{s.rebalance}</div></div>
            <div className="meta-item"><div className="meta-label">业绩基准</div><div className="meta-val">{s.benchmark}</div></div>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">因子配置</div>
          <div className="sc-factors">
            {s.factors.map(f => <span className="factor-tag" key={f.name}>{f.name} <b>{f.weight}%</b></span>)}
          </div>
          <div className="agent-card-text" style={{ margin: "8px 0 0" }}>
            {s.backtestConfig
              ? "由回测卡片保存：因子等权合成，权重不可调；「重新回测」将按原配置重跑真库引擎。"
              : "旧版策略仅支持查看；策略创建与调整已统一到对话，请在对话中重新创建。"}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">绩效概览</div>
          {m ? (
            <>
              <PerfChart curve={s.curve} benchCurve={s.benchCurve} benchName={s.benchmark} dates={s.dates} />
              <MetricGrid metrics={[
                { label: "年化收益", value: fmtPct(m.annual), cls: upDownCls(m.annual) },
                { label: "最大回撤", value: fmtPct(m.drawdown), cls: upDownCls(m.drawdown) },
                { label: "夏普比率", value: m.sharpe.toFixed(2) },
                { label: "胜率", value: m.winRate.toFixed(1) + "%" },
                ...(m.turnover !== undefined ? [{ label: "年化换手(单边)", value: (m.turnover > 0 ? "+" : "") + m.turnover.toFixed(0) + "%" }] : []),
              ]} />
            </>
          ) : (
            <div className="agent-card-text" style={{ margin: "4px 0 12px" }}>
              {s.backtestConfig
                ? "该策略尚未回测，点击「重新回测」按原配置生成报告。"
                : "旧版策略未包含回测数据，仅支持查看；请在对话中重新创建策略。"}
            </div>
          )}
        </div>

        <div className="detail-section">
          <div className="detail-section-title">
            {s.holdings.length ? `当前持仓（展示前 ${s.holdings.length} 只 / Top K = 50）` : "当前持仓"}
          </div>
          {s.holdings.length ? (
            <table className="mini-table">
              <thead>
                <tr><th>股票</th><th className="num">因子得分</th><th className="num">持仓权重</th><th className="num">今日涨跌</th></tr>
              </thead>
              <tbody>
                {s.holdings.map(h => (
                  <tr key={h.code}>
                    <td>{h.name}<span className="stock-code">{h.code}</span></td>
                    <td className="num"><span className="score-pill">{h.score.toFixed(1)}</span></td>
                    <td className="num">{h.weight.toFixed(1)}%</td>
                    <td className={`num ${upDownCls(h.change)}`}>
                      {h.change > 0 ? "+" : ""}{h.change.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="agent-card-text">暂无持仓，完成回测后按最新因子得分自动生成。</div>
          )}
        </div>

        <div className="detail-section" style={{ marginBottom: 0 }}>
          <div className="detail-section-title">回测参数</div>
          <ParamsBlock />
          <div className="agent-card-text" style={{ margin: "8px 0 0" }}>
            以上为本次回测采用的口径，悬停参数可查看说明。
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {/* 破坏性的删除已移到标题栏；创建/调参统一在对话，页脚只保留重跑 */}
        <button className="btn btn-ghost" disabled={busy} onClick={() => void retest()}>
          {busy ? "回测中…" : "重新回测"}
        </button>
      </div>
    </Modal>
  );
}

/* ----- 回测报告弹窗 ----- */

function BacktestReportModal({ s, onClose }: { s: Strategy; onClose: () => void }) {
  const m = s.metrics;
  if (!m) return null;
  return (
    <Modal onClose={onClose} ariaLabel={`回测报告：${s.name}`}>
      <div className="modal-head">
        <div className="modal-title">回测报告 · {s.name}</div>
        <button className="icon-btn" aria-label="关闭" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        <PerfChart curve={s.curve} benchCurve={s.benchCurve} benchName={s.benchmark} dates={s.dates} />
        <MetricGrid metrics={[
          { label: "年化收益", value: fmtPct(m.annual), cls: upDownCls(m.annual) },
          { label: "最大回撤", value: fmtPct(m.drawdown), cls: upDownCls(m.drawdown) },
          { label: "夏普比率", value: m.sharpe.toFixed(2) },
          { label: "胜率", value: m.winRate.toFixed(1) + "%" },
          ...(m.turnover !== undefined ? [{ label: "年化换手(单边)", value: (m.turnover > 0 ? "+" : "") + m.turnover.toFixed(0) + "%" }] : []),
        ]} />
        <div className="detail-section-title" style={{ margin: "18px 0 10px" }}>回测参数</div>
        <ParamsBlock />
        <div className="agent-card-text" style={{ margin: "10px 0 0" }}>
          本报告按上方参数口径、基于当前因子权重与「{s.universe}」股票池模拟生成，收益已扣除手续费；历史业绩不代表未来表现。
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}

/* ----- 新建策略弹窗：选好参数 → 拼成需求话术 → 跳对话预填，点发送即开始回测。
     不再直接建草稿（策略收口到对话真引擎），本弹窗只是"结构化输入的帮手"。
     参数全部对应真引擎入参（StrategyRunConfig）：区间/资金/调仓间隔/持仓数/基准；
     股票池如实固定"全市场"——字典无指数成分表，指数池是演示假象不提供 ----- */

const BENCH_LABELS: Record<string, string> = {
  hs300: "沪深300指数",
  csi500: "中证500指数",
  sse: "上证指数",
};

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isoYearsAgo = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function NewStrategyModal({ onClose, onConfirm, notify }: {
  onClose: () => void;
  onConfirm: (prompt: string) => void;
  notify: (m: string) => void;
}) {
  const { factors: factorLib } = useConfig();
  const [name, setName] = useState("");
  const [range, setRange] = useState<"1y" | "2y" | "3y" | "custom">("1y");
  const [customStart, setCustomStart] = useState(isoYearsAgo(1));
  const [customEnd, setCustomEnd] = useState(isoToday());
  const [capital, setCapital] = useState(1000000);
  const [intervalDays, setIntervalDays] = useState(21);
  const [maxPositions, setMaxPositions] = useState(10);
  const [benchmark, setBenchmark] = useState("hs300");
  const [checked, setChecked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setChecked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const confirm = () => {
    if (!name.trim()) { notify("请填写策略名称"); return; }
    if (!checked.length) { notify("请至少选择一个因子"); return; }
    const startIso = range === "custom" ? customStart : isoYearsAgo(range === "1y" ? 1 : range === "2y" ? 2 : 3);
    const endIso = range === "custom" ? customEnd : isoToday();
    if (range === "custom" && (!startIso || !endIso)) { notify("请选择回测区间起止日期"); return; }
    if (range === "custom" && startIso >= endIso) { notify("回测区间起始日需早于结束日"); return; }
    const factorsText = factorLib.filter(f => checked.includes(f.id))
      .map(f => f.name.replace("因子", "")).join("、");
    /* 需求话术：结构化参数转自然语言，智能体按系统流程确认后走真引擎回测
      （区间如超出因子表数据覆盖，确认门快检会打回并由模型改为可用区间，用户无感） */
    onConfirm(
      `帮我构建一个多因子策略「${name.trim()}」：全市场选股，重点考虑${factorsText}。` +
      `回测区间 ${startIso.replace(/-/g, "")}~${endIso.replace(/-/g, "")}（YYYYMMDD），` +
      `初始资金 ${capital / 10000} 万元，每 ${intervalDays} 个交易日调仓一次，持仓 ${maxPositions} 只，` +
      `业绩基准${BENCH_LABELS[benchmark]}。请按这些要求完成回测并给我回测报告。`,
    );
    onClose();
  };

  return (
    <Modal onClose={onClose} ariaLabel="新建策略">
      <div className="modal-head">
        <div className="modal-title">新建策略</div>
        <button className="icon-btn" aria-label="关闭" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        <div className="detail-section">
          <div className="detail-section-title">策略名称</div>
          <input className="text-input" placeholder="例如：大盘价值轮动策略" aria-label="策略名称"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="detail-section">
          <div className="detail-section-title">回测区间</div>
          <div className="detail-meta" style={{ gridTemplateColumns: range === "custom" ? "1fr 1fr 1fr" : "1fr" }}>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">区间</div>
              <select className="plain-select" value={range} aria-label="选择回测区间" onChange={e => setRange(e.target.value as typeof range)}>
                <option value="1y">近一年</option>
                <option value="2y">近两年</option>
                <option value="3y">近三年</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            {range === "custom" && (
              <>
                <div className="meta-item" style={{ padding: "8px 14px" }}>
                  <div className="meta-label">开始日期</div>
                  <input type="date" className="plain-select" aria-label="回测开始日期"
                    value={customStart} onChange={e => setCustomStart(e.target.value)} />
                </div>
                <div className="meta-item" style={{ padding: "8px 14px" }}>
                  <div className="meta-label">结束日期</div>
                  <input type="date" className="plain-select" aria-label="回测结束日期"
                    value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="detail-section">
          <div className="detail-section-title">资金与调仓</div>
          <div className="detail-meta" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">初始资金</div>
              <select className="plain-select" value={capital} aria-label="选择初始资金" onChange={e => setCapital(+e.target.value)}>
                <option value={100000}>10 万元</option>
                <option value={500000}>50 万元</option>
                <option value={1000000}>100 万元</option>
                <option value={5000000}>500 万元</option>
              </select>
            </div>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">调仓频率</div>
              <select className="plain-select" value={intervalDays} aria-label="选择调仓频率" onChange={e => setIntervalDays(+e.target.value)}>
                <option value={5}>每周（5 个交易日）</option>
                <option value={10}>每两周（10 个交易日）</option>
                <option value={21}>每月（21 个交易日）</option>
                <option value={63}>每季度（63 个交易日）</option>
              </select>
            </div>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">持仓数量</div>
              <select className="plain-select" value={maxPositions} aria-label="选择持仓数量" onChange={e => setMaxPositions(+e.target.value)}>
                <option value={5}>5 只</option>
                <option value={10}>10 只</option>
                <option value={20}>20 只</option>
                <option value={30}>30 只</option>
              </select>
            </div>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">业绩基准</div>
              <select className="plain-select" value={benchmark} aria-label="选择业绩基准" onChange={e => setBenchmark(e.target.value)}>
                <option value="hs300">沪深300指数</option>
                <option value="csi500">中证500指数</option>
                <option value="sse">上证指数</option>
              </select>
            </div>
          </div>
          <div className="agent-card-text" style={{ margin: "8px 0 0" }}>
            股票池：全市场（因子表覆盖）。指数成分股（沪深300 等）数据尚未接入，暂只支持全市场回测。
          </div>
        </div>
        <div className="detail-section" style={{ marginBottom: 0 }}>
          <div className="detail-section-title">选择因子（点击勾选）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {factorLib.map(f => (
              <label key={f.id} className="factor-tag"
                style={{ cursor: "pointer", userSelect: "none", padding: "7px 13px", fontSize: 12 }}>
                <input type="checkbox" checked={checked.includes(f.id)}
                  onChange={() => toggle(f.id)}
                  style={{ accentColor: "var(--primary)", marginRight: 5, verticalAlign: -1 }} />
                {f.name}
              </label>
            ))}
          </div>
          <div className="agent-card-text" style={{ margin: "12px 0 0" }}>
            确定后会跳转到对话页并自动填好以上需求，点击发送即可开始回测；区间若超出数据范围，智能体会自动改用可用区间。
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={confirm}>确定，去对话创建</button>
      </div>
    </Modal>
  );
}

/* ----- 页面 ----- */

export function StrategiesPage({ strategies, loading, notify, onGoChat, onRebacktest, onDelete }: {
  strategies: Strategy[];
  loading: boolean;
  notify: (m: string) => void;
  /** 「确定，去对话创建」：切到对话页并预填需求话术（策略的创建/回测统一在对话完成） */
  onGoChat: (prefill?: string) => void;
  onRebacktest: (id: string) => Promise<Strategy>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Strategy | null>(null);
  const [deleting, setDeleting] = useState(false);
  const detail = strategies.find(s => s.id === detailId) ?? null;
  const report = strategies.find(s => s.id === reportId) ?? null;

  const handleRebacktest = async (s: Strategy) => {
    try {
      await onRebacktest(s.id);
      setDetailId(null);
      setReportId(s.id);
      notify("回测完成");
    } catch (e) {
      notify(e instanceof Error ? e.message : "回测失败");
    }
  };

  const confirmDelete = async () => {
    if (!confirmDel || deleting) return;
    setDeleting(true);
    try {
      await onDelete(confirmDel.id);
      setDetailId(null);
      setConfirmDel(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const backtested = strategies.filter(s => s.metrics);
  const avg = (key: "annual" | "sharpe") =>
    backtested.reduce((a, s) => a + (s.metrics![key] as number), 0) / (backtested.length || 1);
  const running = strategies.filter(s => s.status === "running").length;
  /* 无已回测策略时统计占位 "—"，不展示假的 0.0% */
  const hasStats = backtested.length > 0;

  return (
    <section id="page-strategies" className="page active">
      <header className="page-header">
        <div>
          <h1>我的策略</h1>
          <p className="page-sub">管理你创建的多因子选股策略，查看回测表现</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><IconPlus />新建策略</button>
      </header>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">策略总数</div>
          <div className="stat-value">{strategies.length}<small>个</small></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">运行中</div>
          <div className="stat-value">{running}<small>个</small></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均年化收益</div>
          <div className={`stat-value ${hasStats ? upDownCls(avg("annual")) : ""}`}>
            {hasStats ? fmtPct(avg("annual")) : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均夏普比率</div>
          <div className="stat-value">{hasStats ? avg("sharpe").toFixed(2) : "—"}</div>
        </div>
      </div>

      <div className="strategy-grid">
        {loading ? (
          <div className="empty-state">
            <div className="empty-title">正在从后端加载策略…</div>
          </div>
        ) : strategies.length ? strategies.map(s => (
          <StrategyCard key={s.id} s={s}
            onOpen={() => setDetailId(s.id)}
            onBacktest={() => handleRebacktest(s)}
            onDelete={() => setConfirmDel(s)} />
        )) : (
          <div className="empty-state">
            <div className="empty-icon"><IconLogo size={24} /></div>
            <div className="empty-title">还没有策略</div>
            <div className="empty-desc">点击「新建策略」选好参数，到对话里发送即可回测；回测卡片上「保存为我的策略」收进这里。</div>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}><IconPlus />新建策略</button>
          </div>
        )}
      </div>

      {detail && (
        <StrategyDetailModal key={detail.id} s={detail}
          onClose={() => setDetailId(null)}
          onRebacktest={() => handleRebacktest(detail)}
          onDelete={() => setConfirmDel(detail)} />
      )}
      {showNew && (
        <NewStrategyModal notify={notify}
          onClose={() => setShowNew(false)}
          onConfirm={prompt => { setShowNew(false); onGoChat(prompt); }} />
      )}
      {report && (
        <BacktestReportModal s={report} onClose={() => setReportId(null)} />
      )}
      {confirmDel && (
        <ConfirmModal
          title="删除策略"
          message={`确定删除策略「${confirmDel.name}」吗？此操作不可恢复。`}
          confirmText="删除"
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </section>
  );
}
