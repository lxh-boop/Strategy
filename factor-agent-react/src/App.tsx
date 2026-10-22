import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BacktestCard, Strategy } from "./types";
import {
  ApiError, backtestStrategy as apiBacktest,
  createStrategyFromBacktest, deleteStrategy as apiDeleteStrategy, getHealth, getToken, listStrategies,
  me as apiMe, AUTH_EXPIRED_EVENT, type HealthInfo, type UserPublic,
} from "./api";
import { useConversations } from "./hooks/useConversations";
import { ConfigProvider } from "./config";
import { ChatPage } from "./pages/ChatPage";
import { StrategiesPage } from "./pages/StrategiesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AuthView } from "./components/AuthView";
import { Toast } from "./components/ui";
import { IconChat, IconGrid, IconLogo, IconMoon, IconSun, IconUser } from "./components/icons";

/* ===== 配色主题（浅/深双主题）：缺省固定浅色，手动切换后 localStorage 持久化 ===== */
type Theme = "light" | "dark";
const THEME_KEY = "alphasage_theme_v1";
const getInitialTheme = (): Theme => (localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");

type Page = "chat" | "strategies" | "profile";

function MainApp({ user }: { user: UserPublic }) {
  const [page, setPage] = useState<Page>("chat");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [savedCardIds, setSavedCardIds] = useState<string[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  /* useLayoutEffect：首次绘制前挂 data-theme，深色用户无浅色闪烁 */
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

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

  /** 重新回测（卡片保存的策略按可复现配置重跑真引擎；旧版草稿由后端 400 提示） */
  const rebacktest = async (id: string): Promise<Strategy> => {
    const s = await apiBacktest(id);
    updateStrategyState(id, s);
    return s;
  };

  const deleteStrategyById = async (id: string) => {
    await apiDeleteStrategy(id);
    setStrategies(prev => prev.filter(s => s.id !== id));
  };

  /* 回测卡片（TOOL-C07）→ 保存为策略（API-27）：服务端按卡片 config 重跑真引擎，
     数字与卡片一致；成功后卡片进"已保存 ✓"态。
     策略唯一的出生地是对话——「新建策略」入口也已改为跳转对话（goChat）。 */
  const saveBacktestCard = async (card: BacktestCard): Promise<void> => {
    if (!card.config) return;
    try {
      const saved = await createStrategyFromBacktest(card.title.replace(/\s*等权回测$/, ""), card.config);
      setStrategies(prev => [saved, ...prev]);
      if (card.id) setSavedCardIds(prev => [...prev, card.id!]);
      notify("策略已保存，可在「我的策略」中查看");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "保存策略失败");
    }
  };

  /* 「去对话创建」：切到对话页并预填输入框（草稿在消费前置空，切页重挂载后由 ChatPage 灌入） */
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const goChat = (prefill?: string) => {
    setChatDraft(prefill ?? null);
    setPage("chat");
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
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === "dark" ? "切换浅色" : "切换深色"}
              aria-label={theme === "dark" ? "切换浅色" : "切换深色"}>
              {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
            </button>
          </div>

          <nav className="nav">
            <div className="nav-label">工作台</div>
            {navItems.map(item => (
              <button key={item.key} data-page={item.key}
                className={`nav-item ${page === item.key ? "active" : ""}`}
                onClick={() => setPage(item.key)}>
                {item.icon}
                <span>{item.label}</span>
                {item.key === "strategies" && strategies.length > 0 && <em className="nav-badge">{strategies.length}</em>}
              </button>
            ))}
          </nav>

          <div className="agent-status">
            <div className="agent-status-dot" style={backendDown ? { background: "var(--danger)" } : undefined} />
            <div>
              <div className="agent-status-title">{statusTitle}</div>
              <div className="agent-status-sub">{statusSub}</div>
            </div>
          </div>

          <button className="sidebar-user" onClick={() => setPage("profile")} aria-label="打开个人中心">
            <div className="avatar">{user.nickname.slice(0, 1) || "友"}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.nickname}</div>
            </div>
          </button>
        </aside>

        <main className="main">
          {page === "chat" && (
            <ChatPage
              conversations={conv.conversations}
              currentId={conv.currentId}
              typingId={conv.typingId}
              live={conv.live}
              confirmGate={conv.confirmGate}
              loading={conv.loading}
              backendBusyId={conv.backendBusyId}
              savedCardIds={savedCardIds}
              userNickname={user.nickname}
              onCreate={conv.createConversation}
              onSwitch={conv.switchConversation}
              onDelete={conv.deleteConversation}
              onClear={conv.clearConversation}
              onSubmit={conv.submit}
              onStop={conv.stop}
              onSaveBacktest={saveBacktestCard}
              onGotoStrategies={() => setPage("strategies")}
              draftInput={chatDraft}
              onDraftConsumed={() => setChatDraft(null)}
            />
          )}
          {page === "strategies" && (
            <StrategiesPage
              strategies={strategies}
              loading={strategiesLoading}
              notify={notify}
              onGoChat={goChat}
              onRebacktest={rebacktest}
              onDelete={id => deleteStrategyById(id).then(() => notify("策略已删除")).catch(() => {})}
            />
          )}
          {page === "profile" && <ProfilePage notify={notify} user={user} />}
        </main>

        <Toast msg={toast} />
      </div>
    </ConfigProvider>
  );
}

/* ==========================================================
   鉴权外壳（M13）：启动时校验本地 token（API-24）→ 有效进主应用，
   无效/缺失进登录视图；任意请求 401 会广播 AUTH_EXPIRED_EVENT，
   这里统一切回登录视图。key={user.id} 保证换账号时主应用整体
   重挂载、所有数据重新拉取（会话/策略/资料都按新用户隔离）。
   ========================================================== */
export default function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    void (async () => {
      if (getToken()) {
        try {
          setUser((await apiMe()).user);
        } catch {
          /* token 无效：http() 已清 token 并广播 */
        }
      }
      setAuthReady(true);
    })();
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  if (!authReady) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 14 }}>
        正在连接…
      </div>
    );
  }
  if (!user) return <AuthView onAuthed={setUser} />;
  return <MainApp key={user.id} user={user} />;
}
