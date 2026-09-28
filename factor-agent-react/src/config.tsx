import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { BtParamItem, FactorLibItem } from "./types";
import { BT_PARAMS, FACTOR_LIB } from "./data/mock";
import { getBtParams, getFactors } from "./api";

interface AppConfig {
  factors: FactorLibItem[];
  btParams: BtParamItem[];
}

const ConfigContext = createContext<AppConfig>({ factors: FACTOR_LIB, btParams: BT_PARAMS });

/* ==========================================================
   配置型数据（因子库 / 回测参数）由后端下发（契约 §3.5）：
   后端新增参数项或因子后，前端 UI 自动跟随，无需改代码。
   静态 mock 值仅作后端不可达时的兜底展示。
   ========================================================== */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>({ factors: FACTOR_LIB, btParams: BT_PARAMS });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [factors, btParams] = await Promise.all([getFactors(), getBtParams()]);
        if (!cancelled) setConfig({ factors, btParams });
      } catch {
        /* 后端不可达时沿用内置默认值，UI 正常渲染 */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export const useConfig = () => useContext(ConfigContext);
