import { useState } from "react";
import type { FactorWeight, Strategy } from "../types";
import { useConfig } from "../config";
import { fmtPct, upDownCls } from "../utils/format";
import { PerfChart, Sparkline } from "../components/charts";
import { MetricGrid, Modal, ParamsBlock } from "../components/ui";
import { IconClose, IconInfo, IconPlay, IconPlus, IconTrash } from "../components/icons";
import type { NewStrategyInput } from "../api";

const STATUS: Record<Strategy["status"], { cls: string; text: string }> = {
  running: { cls: "status-running", text: "运行中" },
  done: { cls: "status-done", text: "回测完成" },
  draft: { cls: "status-draft", text: "草稿" },
};

/* ----- 策略卡片 ----- */

function StrategyCard({ s, onOpen, onBacktest, onDelete }: {
  s: Strategy;
  onOpen: () => void;
  onBacktest: () => void;
  onDelete: () => void;
}) {
  const st = STATUS[s.status];
  const m = s.metrics;
  return (
    <div className="card strategy-card" onClick={onOpen}>
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
          <button className="icon-btn" title="详情" onClick={e => { e.stopPropagation(); onOpen(); }}><IconInfo /></button>
          <button className="icon-btn" title="重新回测" onClick={e => { e.stopPropagation(); onBacktest(); }}><IconPlay /></button>
          <button className="icon-btn" title="删除" onClick={e => { e.stopPropagation(); onDelete(); }}><IconTrash /></button>
        </div>
      </div>
    </div>
  );
}

/* ----- 策略详情弹窗（因子权重可调） ----- */

function StrategyDetailModal({ s, onClose, onSaveWeights, onRebacktest, onDelete }: {
  s: Strategy;
  onClose: () => void;
  onSaveWeights: (factors: FactorWeight[]) => void;
  onRebacktest: () => void;
  onDelete: () => void;
}) {
  const [weights, setWeights] = useState<FactorWeight[]>(s.factors.map(f => ({ ...f })));
  const m = s.metrics;
  const total = weights.reduce((a, f) => a + f.weight, 0);
  const setW = (i: number, weight: number) =>
    setWeights(prev => prev.map((f, j) => (j === i ? { ...f, weight } : f)));

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">
          {s.name}
          <span className={`status-badge ${STATUS[s.status].cls}`}>{STATUS[s.status].text}</span>
        </div>
        <button className="icon-btn" onClick={onClose}><IconClose /></button>
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
          <div className="detail-section-title">因子权重（可拖动调整）</div>
          {weights.map((f, i) => (
            <div className="weight-slider-row" key={f.name}>
              <span className="ws-name">{f.name}</span>
              <div className="ws-bar"><i style={{ width: `${f.weight}%` }} /></div>
              <input type="range" min={0} max={100} value={f.weight}
                onChange={e => setW(i, +e.target.value)} />
              <span className="ws-val">{f.weight}%</span>
              <span />
            </div>
          ))}
          <div className="weight-total">
            当前合计 <b>{total}%</b> / 100%
            {total !== 100 && " · 保存时按比例自动折算为 100"}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-title">绩效概览</div>
          {m ? (
            <>
              <PerfChart curve={s.curve} benchCurve={s.benchCurve} benchName={s.benchmark} />
              <MetricGrid metrics={[
                { label: "年化收益", value: fmtPct(m.annual), cls: upDownCls(m.annual) },
                { label: "最大回撤", value: fmtPct(m.drawdown), cls: upDownCls(m.drawdown) },
                { label: "夏普比率", value: m.sharpe.toFixed(2) },
                { label: "胜率", value: m.winRate.toFixed(1) + "%" },
              ]} />
            </>
          ) : (
            <div className="agent-card-text" style={{ margin: "4px 0 12px" }}>
              该策略尚未回测，保存配置后将自动生成回测报告。
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
                <tr><th>股票</th><th>因子得分</th><th>持仓权重</th><th>今日涨跌</th></tr>
              </thead>
              <tbody>
                {s.holdings.map(h => (
                  <tr key={h.code}>
                    <td>{h.name}<span className="stock-code">{h.code}</span></td>
                    <td><span className="score-pill">{h.score.toFixed(1)}</span></td>
                    <td>{h.weight.toFixed(1)}%</td>
                    <td className={upDownCls(h.change)}>
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
            以上为本次回测采用的口径，悬停参数可查看说明；调整因子权重并保存后将按新配置重新回测。
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onDelete}>删除策略</button>
        <button className="btn btn-ghost" onClick={onRebacktest}>重新回测</button>
        <button className="btn btn-primary" onClick={() => onSaveWeights(weights)}>保存并生成回测报告</button>
      </div>
    </Modal>
  );
}

/* ----- 回测报告弹窗 ----- */

function BacktestReportModal({ s, onClose, notify }: {
  s: Strategy;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const m = s.metrics;
  if (!m) return null;
  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">回测报告 · {s.name}</div>
        <button className="icon-btn" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        <PerfChart curve={s.curve} benchCurve={s.benchCurve} benchName={s.benchmark} />
        <MetricGrid metrics={[
          { label: "年化收益", value: fmtPct(m.annual), cls: upDownCls(m.annual) },
          { label: "最大回撤", value: fmtPct(m.drawdown), cls: upDownCls(m.drawdown) },
          { label: "夏普比率", value: m.sharpe.toFixed(2) },
          { label: "胜率", value: m.winRate.toFixed(1) + "%" },
        ]} />
        <div className="detail-section-title" style={{ margin: "18px 0 10px" }}>回测参数</div>
        <ParamsBlock />
        <div className="agent-card-text" style={{ margin: "10px 0 0" }}>
          本报告按上方参数口径、基于当前因子权重与「{s.universe}」股票池模拟生成，收益已扣除手续费；历史业绩不代表未来表现。
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        <button className="btn btn-primary" onClick={() => notify("回测报告已导出（演示）")}>导出报告</button>
      </div>
    </Modal>
  );
}

/* ----- 新建策略弹窗 ----- */

function NewStrategyModal({ onClose, onCreate, notify }: {
  onClose: () => void;
  onCreate: (input: NewStrategyInput) => Promise<Strategy>;
  notify: (m: string) => void;
}) {
  const { factors: factorLib } = useConfig();
  const [name, setName] = useState("");
  const [universe, setUniverse] = useState("沪深300");
  const [rebalance, setRebalance] = useState("每月调仓");
  const [checked, setChecked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) =>
    setChecked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const create = async () => {
    if (!name.trim()) { notify("请填写策略名称"); return; }
    if (!checked.length) { notify("请至少选择一个因子"); return; }
    const per = Math.floor(100 / checked.length);
    const factors: FactorWeight[] = factorLib
      .filter(f => checked.includes(f.id))
      .map((f, i) => ({
        name: f.name.replace("因子", ""),
        weight: i === 0 ? 100 - per * (checked.length - 1) : per,
      }));
    setSubmitting(true);
    try {
      /* 权重不要求合计 100：后端保存时会按比例归一化 */
      await onCreate({ name: name.trim(), universe, rebalance, factors });
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "创建策略失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">新建策略</div>
        <button className="icon-btn" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        <div className="detail-section">
          <div className="detail-section-title">策略名称</div>
          <input className="text-input" placeholder="例如：大盘价值轮动策略"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="detail-section">
          <div className="detail-section-title">股票池与调仓</div>
          <div className="detail-meta" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">股票池</div>
              <select className="plain-select" value={universe} onChange={e => setUniverse(e.target.value)}>
                <option>沪深300</option><option>中证500</option><option>中证800</option>
                <option>中证1000</option><option>全市场（剔除ST）</option>
              </select>
            </div>
            <div className="meta-item" style={{ padding: "8px 14px" }}>
              <div className="meta-label">调仓频率</div>
              <select className="plain-select" value={rebalance} onChange={e => setRebalance(e.target.value)}>
                <option>每周调仓</option><option>每月调仓</option><option>每季度调仓</option>
              </select>
            </div>
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
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={submitting} onClick={create}>
          {submitting ? "创建中…" : "创建策略"}
        </button>
      </div>
    </Modal>
  );
}

/* ----- 页面 ----- */

export function StrategiesPage({ strategies, loading, notify, onAdd, onSaveWeights, onRebacktest, onDelete }: {
  strategies: Strategy[];
  loading: boolean;
  notify: (m: string) => void;
  onAdd: (input: NewStrategyInput) => Promise<Strategy>;
  onSaveWeights: (id: string, factors: FactorWeight[]) => Promise<Strategy>;
  onRebacktest: (id: string) => Promise<Strategy>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const detail = strategies.find(s => s.id === detailId) ?? null;
  const report = strategies.find(s => s.id === reportId) ?? null;

  const handleSaveWeights = async (s: Strategy, rawFactors: FactorWeight[]) => {
    const total = rawFactors.reduce((a, f) => a + f.weight, 0);
    if (total <= 0) {
      notify("因子权重不能全部为 0");
      return;
    }
    try {
      /* 权重原样提交，后端归一化（合计 ≠ 100 按比例折算）并随保存自动重新回测 */
      await onSaveWeights(s.id, rawFactors);
      setDetailId(null);
      setReportId(s.id);
      notify(total === 100
        ? "因子权重已保存，已按新配置完成回测"
        : `权重合计 ${total}%，已自动折算为 100% 并完成回测`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "保存失败");
    }
  };

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

  const handleDelete = async (s: Strategy) => {
    if (!window.confirm(`确定删除策略「${s.name}」吗？此操作不可恢复。`)) return;
    try {
      await onDelete(s.id);
      setDetailId(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "删除失败");
    }
  };

  const backtested = strategies.filter(s => s.metrics);
  const avg = (key: "annual" | "sharpe") =>
    backtested.reduce((a, s) => a + (s.metrics![key] as number), 0) / (backtested.length || 1);
  const running = strategies.filter(s => s.status === "running").length;

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
          <div className="stat-value up">{fmtPct(avg("annual"))}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均夏普比率</div>
          <div className="stat-value">{avg("sharpe").toFixed(2)}</div>
        </div>
      </div>

      <div className="strategy-grid">
        {loading ? (
          <div className="agent-card-text">正在从后端加载策略…</div>
        ) : strategies.length ? strategies.map(s => (
          <StrategyCard key={s.id} s={s}
            onOpen={() => setDetailId(s.id)}
            onBacktest={() => handleRebacktest(s)}
            onDelete={() => handleDelete(s)} />
        )) : (
          <div className="agent-card-text">暂无策略，点击右上角「新建策略」创建。</div>
        )}
      </div>

      {detail && (
        <StrategyDetailModal key={detail.id} s={detail}
          onClose={() => setDetailId(null)}
          onSaveWeights={f => handleSaveWeights(detail, f)}
          onRebacktest={() => handleRebacktest(detail)}
          onDelete={() => handleDelete(detail)} />
      )}
      {showNew && (
        <NewStrategyModal notify={notify}
          onClose={() => setShowNew(false)}
          onCreate={async input => {
            const s = await onAdd(input);
            notify(`策略「${s.name}」已创建（草稿），保存配置后自动生成回测报告`);
            return s;
          }} />
      )}
      {report && (
        <BacktestReportModal s={report} notify={notify} onClose={() => setReportId(null)} />
      )}
    </section>
  );
}
