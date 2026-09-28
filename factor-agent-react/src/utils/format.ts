/* 通用格式化工具 */

export const fmtPct = (v: number | null, signed = true): string =>
  v == null ? "—" : (signed && v > 0 ? "+" : "") + v.toFixed(1) + "%";

export const upDownCls = (v: number): string => (v > 0 ? "up" : v < 0 ? "down" : "");

export const nowTime = (): string => {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

export const todayStr = (): string => new Date().toISOString().slice(5, 10);

export const fmtConvDate = (ts: number): string => {
  const d = new Date();
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return d.toDateString() === now.toDateString()
    ? hm
    : String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

export const totalReturnPct = (arr: number[]): number =>
  (arr[arr.length - 1] / arr[0] - 1) * 100;
