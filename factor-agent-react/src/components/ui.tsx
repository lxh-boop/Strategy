import { useEffect, type ReactNode } from "react";
import type { BtParamItem, MetricItem } from "../types";
import { useConfig } from "../config";

/* 通用弹窗：遮罩点击 / Esc 关闭 */
export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-mask" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">{children}</div>
    </div>
  );
}

/* Toast 轻提示（全局挂载一个，受控显示） */
export function Toast({ msg }: { msg: string | null }) {
  return <div id="toast" className={msg ? "show" : ""}>{msg ?? ""}</div>;
}

/* 绩效指标网格 */
export function MetricGrid({ metrics }: { metrics: MetricItem[] }) {
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

/* 回测参数说明（悬停查看口径）：
   - 缺省（策略页/旧卡片）：显示 GET /api/backtest-params 下发的配置项；
   - 传入 items（智能体回测卡片）：显示本次回测真实使用的参数（后端 TOOL-C07 产出） */
export function ParamsBlock({ items }: { items?: BtParamItem[] }) {
  const { btParams } = useConfig();
  const rows = items && items.length > 0 ? items : btParams;
  return (
    <>
      <div className="btp-title">回测参数（悬停查看口径）</div>
      <div className="bt-params">
        {rows.map(p => (
          <div className="btp-item" key={p.label} title={p.hint}>
            <div className="btp-label">{p.label}</div>
            <div className="btp-val">{p.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}
