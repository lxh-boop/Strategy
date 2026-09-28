import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReportCard, Strategy } from "./types";
import {
  ApiError, backtestStrategy as apiBacktest, createStrategy,
  deleteStrategy as apiDeleteStrategy, getHealth, listStrategies, updateStrategy,
  type HealthInfo, type NewStrategyInput,
} from "./api";
import { useConversations } from "./hooks/useConversations";
import { ConfigProvider } from "./config";
import { ChatPage } from "./pages/ChatPage";
import { StrategiesPage } from "./pages/StrategiesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { Toast } from "./components/ui";
import { IconChat, IconGrid, IconLogo, IconUser } from "./components/icons";

type Page = "chat" | "strategies" | "profile";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [savedCardIds, setSavedCardIds] = useState<string[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  /* Toast 轻提示 */
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = (msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2200);
  };

  const conv = useConversations(notify);

  /* 首次加载：策略列表 + 后端健康状态（侧边栏状态灯） */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listStrategies();
        if (!cancelled) setStrategies(list);
      } catch (e) {
        if (!cancelled) {
          setBackendDown(true);
          notify(e instanceof ApiError ? e.message : "策略加载失败");
        }
      } finally {
        if (!cancelled) setStrategiesLoading(false);
      }
    })();
    void getHealth()
      .then(h => { if (!cancelled) { setHealth(h); setBackendDown(false); } })
      .catch(() => { if (!cancelled) setBackendDown(true); });
    return () => { cancelled = true; };
  }, []);

  const updateStrategyState = (id: string, next: Strategy) =>
    setStrategies(prev => prev.map(s => (s.id === id ? next : s)));

  /* ----- 策略操作（全部走后端，契约 §3.2） ----- */

  /** 新建策略（草稿）：后端补全字段并归一化因子权重 */
  const addStrategy = async (input: NewStrategyInput): Promise<Strategy> => {
    const s = await createStrategy(input);
    setStrategies(prev => [s, ...prev]);
    return s;
  };

  /** 保存因子权重 = 后端自动重新回测（保存与回测是同一动作） */
  const saveWeights = async (id: string, factors: NewStrategyInput["factors"]): Promise<Strategy> => {
    const s = await updateStrategy(id, { factors });
    updateStrategyState(id, s);
    return s;
  };

  /** 重新回测 */
  const rebacktest = async (id: string): Promise<Strategy> => {
    const s = await apiBacktest(id);
    updateStrategyState(id, s);
    return s;
  };

  const deleteStrategyById = async (id: string) => {
    await apiDeleteStrategy(id);
    setStrategies(prev => prev.filter(s => s.id !== id));
  };

  /* 对话报告卡 → 保存为策略：先建草稿，再让后端按该配置出正式回测报告 */
  const saveStrategyFromCard = async (card: ReportCard) => {
    const name = card.title.replace(/\s*·\s*(回测报告|策略框架|参考框架)$/, "");
    try {
      const draft = await createStrategy({
        name,
        universe: card.universe,
        rebalance: card.rebalance,
        benchmark: card.benchName,
        factors: card.factors.map(f => ({ ...f })),
      });
      const saved = draft.metrics ? draft : await apiBacktest(draft.id);
      setStrategies(prev => [saved, ...prev]);
      if (card.id) setSavedCardIds(prev => [...prev, card.id!]);
      notify("策略已保存，可在「我的策略」中查看");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "保存策略失败");
    }
  };

  const navItems: { key: Page; label: string; icon: ReactNode }[] = [
    { key: "chat", label: "对话选股", icon: <IconChat /> },
    { key: "strategies", label: "我的策略", icon: <IconGrid /> },
    { key: "profile", label: "个人中心", icon: <IconUser /> },
  ];

  /* 侧边栏智能体状态：由 GET /api/health 驱动 */
  const statusTitle = backendDown ? "后端离线" : health ? "智能体在线" : "正在连接后端…";
  const statusSub = backendDown
    ? "请启动 factor-agent-server"
    : health
      ? health.zhipuConfigured ? `GLM 已接入 · ${health.defaultModel}` : "GLM 未配置 · 模板文案"
      : "GET /api/health";

  return (
    <ConfigProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <div className="logo-mark"><IconLogo size={22} /></div>
            <div className="logo-text">
              <span className="logo-name">因子智投</span>
              <span className="logo-sub">AlphaSage Agent</span>
            </div>
          </div>

          <nav className="nav">
            <div className="nav-label">工作台</div>
            {navItems.map(item => (
              <button key={item.key} data-page={item.key}
                className={`nav-item ${page === item.key ? "active" : ""}`}
                onClick={() => setPage(item.key)}>
                {item.icon}
                <span>{item.label}</span>
                {item.key === "strategies" && <em className="nav-badge">{strategies.length}</em>}
              </button>
            ))}
          </nav>

          <div className="agent-status">
            <div className="agent-status-dot" style={backendDown ? { background: "#e5484d" } : undefined} />
            <div>
              <div className="agent-status-title">{statusTitle}</div>
              <div className="agent-status-sub">{statusSub}</div>
            </div>
          </div>

          <div className="sidebar-user" onClick={() => setPage("profile")}>
            <div className="avatar">陈</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">陈研究员</div>
              <div className="sidebar-user-plan">专业版会员</div>
            </div>
          </div>
        </aside>

        <main className="main">
          {page === "chat" && (
            <ChatPage
              conversations={conv.conversations}
              currentId={conv.currentId}
              typingId={conv.typingId}
              loading={conv.loading}
              savedCardIds={savedCardIds}
              notify={notify}
              onCreate={conv.createConversation}
              onSwitch={conv.switchConversation}
              onDelete={conv.deleteConversation}
              onClear={conv.clearConversation}
              onSubmit={conv.submit}
              onSaveStrategy={saveStrategyFromCard}
              onGotoStrategies={() => setPage("strategies")}
            />
          )}
          {page === "strategies" && (
            <StrategiesPage
              strategies={strategies}
              loading={strategiesLoading}
              notify={notify}
              onAdd={addStrategy}
              onSaveWeights={saveWeights}
              onRebacktest={rebacktest}
              onDelete={id => deleteStrategyById(id).then(() => notify("策略已删除")).catch(() => {})}
            />
          )}
          {page === "profile" && <ProfilePage notify={notify} />}
        </main>

        <Toast msg={toast} />
      </div>
    </ConfigProvider>
  );
}
