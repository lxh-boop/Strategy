import type { AttributionCard } from "../types";

/* 归因分析表格组（对话卡与策略页共用）：个股贡献正/拖累双榜、规则贡献、行为四分类、回撤窗、反事实矩阵 */

const num = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(0);

export function AttributionTables({ card }: { card: AttributionCard }) {
  const stocks = [...card.stocks].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const gainers = stocks.filter((s) => s.total > 0).slice(0, 5);
  const laggards = stocks.filter((s) => s.total < 0).slice(-5).reverse();
  return (
    <>
      <div className="agent-card-text">
        {card.sourceCard ? `${card.sourceCard} · ` : ""}生成于 {card.generatedAt} · 全口径 = 已实现 FIFO + 期末浮动
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="btp-title">个股贡献（正贡献 top5）</div>
        <div className="trade-scroll">
          <table className="mini-table">
            <thead>
              <tr><th>代码</th><th className="num">已实现</th><th className="num">浮动</th><th className="num">合计</th><th className="num">胜率</th></tr>
            </thead>
            <tbody>
              {gainers.map((s) => (
                <tr key={s.code}>
                  <td>{s.code}</td>
                  <td className="num">{s.realized.toFixed(0)}</td>
                  <td className={`num ${s.floating >= 0 ? "up" : "down"}`}>{s.floating.toFixed(0)}</td>
                  <td className={`num ${s.total >= 0 ? "up" : "down"}`}>{num(s.total)}</td>
                  <td className="num">{s.winRatePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btp-title" style={{ marginTop: 10 }}>个股拖累（bottom5）</div>
        <div className="trade-scroll">
          <table className="mini-table">
            <thead>
              <tr><th>代码</th><th className="num">已实现</th><th className="num">浮动</th><th className="num">合计</th><th className="num">胜率</th></tr>
            </thead>
            <tbody>
              {laggards.map((s) => (
                <tr key={s.code}>
                  <td>{s.code}</td>
                  <td className="num">{s.realized.toFixed(0)}</td>
                  <td className={`num ${s.floating >= 0 ? "up" : "down"}`}>{s.floating.toFixed(0)}</td>
                  <td className={`num ${s.total >= 0 ? "up" : "down"}`}>{num(s.total)}</td>
                  <td className="num">{s.winRatePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="btp-title">卖出规则贡献</div>
        <div className="trade-scroll">
          <table className="mini-table">
            <thead>
              <tr><th>规则</th><th className="num">笔数</th><th className="num">已实现盈亏</th><th className="num">平均持有天数</th></tr>
            </thead>
            <tbody>
              {card.rules.map((r) => (
                <tr key={r.reason}>
                  <td>{r.reason}</td>
                  <td className="num">{r.count}</td>
                  <td className={`num ${r.realized >= 0 ? "up" : "down"}`}>{r.realized.toFixed(0)}</td>
                  <td className="num">{r.avgHoldingDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="btp-title">亏损行为四分类（笔数 / 亏损金额）</div>
        <div className="monthly-strip">
          {Object.entries(card.behavior.counts).map(([k, n]) => (
            <span key={k} className="monthly-chip" title={`亏损金额 ${Math.round(card.behavior.lossAmount[k] ?? 0)}`}>
              {k} {n} 笔 · 亏 {Math.round(card.behavior.lossAmount[k] ?? 0)}
            </span>
          ))}
        </div>
      </div>
      {card.drawdowns.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="btp-title">回撤窗口（深度降序，前 5）</div>
          <div className="trade-scroll">
            <table className="mini-table">
              <thead>
                <tr><th>峰</th><th>谷</th><th className="num">深度%</th><th className="num">天数</th><th>修复</th></tr>
              </thead>
              <tbody>
                {[...card.drawdowns].sort((a, b) => b.depthPct - a.depthPct).slice(0, 5).map((d, i) => (
                  <tr key={i}>
                    <td>{d.peak}</td>
                    <td>{d.trough}</td>
                    <td className="num down">{d.depthPct.toFixed(1)}</td>
                    <td className="num">{d.days}</td>
                    <td>{d.recover > 0 ? "已修复" : "未修复"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {card.counterfactuals.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="btp-title">反事实规则复盘（剔除单条规则重跑 vs 原策略）</div>
          <div className="trade-scroll">
            <table className="mini-table">
              <thead>
                <tr><th>剔除规则</th><th className="num">年化%</th><th className="num">回撤%</th><th className="num">笔数</th></tr>
              </thead>
              <tbody>
                {card.counterfactuals.map((c, i) => (
                  <tr key={i}>
                    <td>{c.removed}</td>
                    <td className={`num ${c.annualPct !== null && c.annualPct >= 0 ? "up" : "down"}`}>
                      {c.annualPct === null ? "—" : c.annualPct.toFixed(1)}
                    </td>
                    <td className="num">{c.drawdownPct === null ? "—" : c.drawdownPct.toFixed(1)}</td>
                    <td className="num">{c.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
