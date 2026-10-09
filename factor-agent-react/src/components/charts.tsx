import { useId } from "react";
import { fmtPct, totalReturnPct, upDownCls } from "../utils/format";

/* 迷你收益曲线（策略卡片） */
export function Sparkline({ data, width = 320, height = 56 }: { data: number[]; width?: number; height?: number }) {
  const gid = "sp" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = 4;
  const range = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * (width - 2) + 1;
  const y = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) / range) * (height - pad * 2));
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color = data[data.length - 1] >= data[0] ? "var(--up)" : "var(--down)"; // A股惯例：红涨绿跌
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`1,${height} ${pts} ${width - 1},${height}`} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* 回测净值曲线（组合 vs 基准）。
   x 轴刻度优先用逐点真实交易日（dates，YYYYMMDD）；未提供时按"末点=当前月"的月频口径推算。 */
export function BacktestChart({ p, bench, dates, width = 640, height = 190 }: {
  p: number[]; bench: number[]; dates?: number[]; width?: number; height?: number;
}) {
  const gid = "bt" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const padL = 46, padR = 12, padT = 14, padB = 26;
  const lo = Math.floor((Math.min(...p, ...bench) - 2) / 5) * 5;
  const hi = Math.ceil((Math.max(...p, ...bench) + 2) / 5) * 5;
  const x = (i: number) => padL + (i / (p.length - 1)) * (width - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (height - padT - padB);
  const pts = (arr: number[]) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const n = p.length;
  const hasDates = !!dates && dates.length === n;
  const tickLabel = (i: number): string => {
    if (hasDates) {
      const d = String(dates![Math.min(n - 1, Math.max(0, i))]);
      return `${d.slice(0, 4)}-${d.slice(4, 6)}`;
    }
    const now = new Date();
    const monthsBack = Math.round((n - 1) * (1 - (n > 1 ? i / (n - 1) : 0)));
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const tickIdx = (n >= 8 ? [0, 1 / 3, 2 / 3, 1] : [0, 1]).map(f => Math.round(f * (n - 1)));
  const xLabels = tickIdx.map((idx, k) => ({ idx, text: tickLabel(idx), key: k }));
  /* 净值口径起点 100：区间覆盖 100 时画出基准参考线 */
  const showBase = lo < 100 && hi > 100;
  return (
    <svg viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f5df0" stopOpacity=".18" />
          <stop offset="1" stopColor="#4f5df0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map(i => {
        const v = lo + ((hi - lo) * i) / 3;
        const yy = y(v).toFixed(1);
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke="#eef1f7" strokeWidth="1" />
            <text x={padL - 8} y={+yy + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{Math.round(v)}</text>
          </g>
        );
      })}
      {showBase && (
        <g>
          <line x1={padL} y1={y(100).toFixed(1)} x2={width - padR} y2={y(100).toFixed(1)}
            stroke="var(--bench-line)" strokeWidth="1" strokeDasharray="2 3" />
          <text x={width - padR} y={y(100) - 4} textAnchor="end" fontSize="10" fill="var(--text-3)">净值 100</text>
        </g>
      )}
      {xLabels.map(({ idx, text, key }, i) => (
        <text key={key}
          x={x(idx).toFixed(1)}
          y={height - 6}
          textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
          fontSize="11" fill="var(--text-3)">
          {text}
        </text>
      ))}
      <polygon points={`${padL},${height - padB} ${pts(p)} ${width - padR},${height - padB}`} fill={`url(#${gid})`} />
      <polyline points={pts(bench)} fill="none" stroke="var(--bench-line)" strokeWidth="1.8" strokeDasharray="5 4" />
      <polyline points={pts(p)} fill="none" stroke="#4f5df0" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* 区间收益高亮条 */
export function ReturnStrip({ curve, benchCurve }: { curve: number[]; benchCurve: number[] }) {
  const pr = totalReturnPct(curve);
  const br = totalReturnPct(benchCurve);
  const items: [string, number][] = [
    ["组合区间收益", pr],
    ["基准区间收益", br],
    ["超额收益", pr - br],
  ];
  return (
    <div className="bt-return">
      {items.map(([label, v]) => (
        <div className="btr-item" key={label}>
          <span className="btr-label">{label}</span>
          <span className={`btr-val ${upDownCls(v)}`}>{fmtPct(v)}</span>
        </div>
      ))}
    </div>
  );
}

/* 图表 + 区间收益的组合块 */
export function PerfChart({ curve, benchCurve, benchName, dates }: {
  curve?: number[]; benchCurve?: number[]; benchName?: string; dates?: number[];
}) {
  if (!curve || !benchCurve) return null;
  return (
    <div className="bt-chart">
      <div className="bt-legend">
        <span><i className="lg-line" />策略组合</span>
        <span><i className="lg-line lg-bench" />业绩基准（{benchName || "业绩基准"}）</span>
      </div>
      <BacktestChart p={curve} bench={benchCurve} dates={dates} />
      <ReturnStrip curve={curve} benchCurve={benchCurve} />
    </div>
  );
}

/* 因子偏好雷达图：少于 3 个维度无法成面，渲染诚实空态而非破损图形 */
export function RadarChart({ items }: { items: { name: string; value: number }[] }) {
  if (!items || items.length < 3) {
    return <div className="radar-empty">暂无数据 · 构建策略后自动生成因子偏好画像</div>;
  }
  const cx = 130, cy = 112, R = 78;
  const N = items.length;
  const angle = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2;
  const pt = (i: number, r: number): [number, number] => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const fmt = (p: [number, number]) => p.map(n => n.toFixed(1)).join(",");
  const dataPts = items.map((it, i) => pt(i, (R * it.value) / 100));
  return (
    <svg viewBox="0 0 260 230" role="img" aria-label="因子偏好雷达图">
      {[0.25, 0.5, 0.75, 1].map(r => (
        <polygon key={r} points={items.map((_, i) => fmt(pt(i, R * r))).join(" ")} fill="none" stroke="#e8ecf4" strokeWidth="1" />
      ))}
      {items.map((it, i) => {
        const [lx, ly] = pt(i, R + 18);
        const anchor = Math.abs(lx - cx) < 10 ? "middle" : lx > cx ? "start" : "end";
        return (
          <g key={it.name}>
            <line x1={cx} y1={cy} x2={pt(i, R)[0].toFixed(1)} y2={pt(i, R)[1].toFixed(1)} stroke="#dfe4ee" strokeWidth="1" />
            <text x={lx.toFixed(1)} y={(ly + 4).toFixed(1)} textAnchor={anchor} fontSize="11" fill="var(--text-2)">
              {it.name} {it.value}
            </text>
          </g>
        );
      })}
      <polygon points={dataPts.map(fmt).join(" ")} fill="rgba(79,93,240,.18)" stroke="#4f5df0" strokeWidth="2" />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r="3" fill="#4f5df0" />
      ))}
    </svg>
  );
}
