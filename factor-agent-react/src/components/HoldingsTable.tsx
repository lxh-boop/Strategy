import type { PeriodHoldingsRow } from "../types";

/** 每期期末持仓表（证券/股数/期末收盘/进入价格/期间收益/权重）——回测卡片、策略详情、历史面板共用 */
export function PeriodHoldingsTable({ holdings }: { holdings: PeriodHoldingsRow["holdings"] }) {
  return (
    <div className="trade-scroll">
      <table className="mini-table">
        <thead>
          <tr><th>证券</th><th className="num">股数</th><th className="num">期末收盘</th>
            <th className="num">进入价格</th><th className="num">期间收益%</th><th className="num">权重%</th></tr>
        </thead>
        <tbody>
          {holdings.map(h => (
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
  );
}
