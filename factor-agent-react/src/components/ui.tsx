import { useEffect, useRef, type ReactNode } from "react";
import type { BtParamItem, MetricItem } from "../types";
import { useConfig } from "../config";
import { IconClose } from "./icons";

/* 通用弹窗：遮罩点击 / Esc 关闭；打开时移入焦点并做 Tab 循环，关闭归还焦点 */
export function Modal({ children, onClose, ariaLabel }: { children: ReactNode; onClose: () => void; ariaLabel?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);

  /* 焦点移入只在挂载时做一次：随渲染重跑会反复抢焦点——弹窗内输入框每敲一个字
     触发父组件重渲染，焦点被抢回容器，表现为"输入框没法输入" */
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !box) return;
      /* 焦点陷阱：Tab/Shift+Tab 在弹窗内循环，不漏到背后的页面 */
      const items = box.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-mask" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={ariaLabel} ref={boxRef} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/* 破坏性操作确认弹窗：全站删除/清空统一走这里（替代原生 confirm） */
export function ConfirmModal({ title, message, confirmText = "删除", busy = false, onConfirm, onClose }: {
  title: string;
  message: string;
  confirmText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} ariaLabel={title}>
      <div className="modal-head">
        <div className="modal-title">{title}</div>
        <button className="icon-btn" aria-label="关闭" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        <div className="agent-card-text" style={{ margin: 0 }}>{message}</div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button>
        <button className="btn btn-danger" disabled={busy} onClick={onConfirm}>
          {busy ? "处理中…" : confirmText}
        </button>
      </div>
    </Modal>
  );
}

/* Toast 轻提示（全局挂载一个，受控显示）；aria-live 让读屏软件也能听到 */
export function Toast({ msg }: { msg: string | null }) {
  return <div id="toast" role="status" aria-live="polite" className={msg ? "show" : ""}>{msg ?? ""}</div>;
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
