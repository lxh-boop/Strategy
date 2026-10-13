/* ==========================================================
   后端 API 统一封装 — 所有对后端的访问都从这里走
   联调期经 Vite 代理（vite.config.ts 里 /api → http://localhost:3000），
   生产期同域部署时无需改动。
   错误格式按契约：{ "error": { "code", "message" } }
   ========================================================== */
import type {
  AgentCard,
  BacktestRunConfig,
  StrategyRunConfig,
  ChatMessage,
  ChatProgressEvent,
  Conversation,
  FactorLibItem,
  Strategy,
  UserProfile,
} from "./types";

/** 后端不可达 / 业务错误统一抛这个，调用方 catch 后 notify 提示 */
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ----- 前端日志上报（落盘后端 logs/frontend/YYYY-MM-DD.log，与后端日志分文件夹） ----- */

/** 限流：每分钟最多 30 条；10s 内相同 message 去重——防止错误风暴刷爆日志文件 */
const reportCounters = { windowStart: 0, count: 0, lastMessage: "", lastAt: 0 };

/**
 * 上报一条前端日志（经 POST /api/client-logs 落盘）。
 * 只进不抛：上报自身失败静默丢弃（用裸 fetch 且不再上报，杜绝递归）。
 * 前端没有任何本地持久化，浏览器 console 关掉就没了——这里就是前端日志的唯一出口。
 */
export function reportClientLog(
  level: "error" | "warn" | "info",
  message: string,
  detail?: Record<string, unknown>,
): void {
  try {
    const now = Date.now();
    if (now - reportCounters.windowStart > 60_000) {
      reportCounters.windowStart = now;
      reportCounters.count = 0;
    }
    if (++reportCounters.count > 30) return;
    if (message === reportCounters.lastMessage && now - reportCounters.lastAt < 10_000) return;
    reportCounters.lastMessage = message;
    reportCounters.lastAt = now;

    const token = getToken();
    void fetch("/api/client-logs", {
      method: "POST",
      keepalive: true, // 页面即将关闭也尽量把这条发出去
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ level, message, detail, page: location.pathname }),
    }).catch(() => {});
  } catch {
    /* 日志上报永不影响业务 */
  }
}

/** 全局钩子：未捕获异常与未处理的 Promise 拒绝自动上报（api.ts 里已手动上报的失败会走限流去重） */
export function installClientLogHooks(): void {
  window.addEventListener("error", e => reportClientLog("error", `未捕获异常: ${e.message}`, { source: e.filename ? `${e.filename}:${e.lineno}` : undefined }));
  window.addEventListener("unhandledrejection", e => {
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
    reportClientLog("error", `未处理的 Promise 拒绝: ${reason}`);
  });
}

async function http<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
  let res: Response;
  const token = getToken();
  // 请求超时：防止连接挂起导致调用方永久等待（发送场景下 inFlight 不清除、按钮永久无反应）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch("/api" + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const reason = e instanceof DOMException && e.name === "AbortError" ? "timeout" : "network";
    reportClientLog("error", `网络失败 ${method} ${path}`, { reason });
    if (reason === "timeout") {
      throw new ApiError("TIMEOUT", `请求超时（${Math.round(timeoutMs / 1000)}s），请稍后重试`);
    }
    throw new ApiError("NETWORK_ERROR", "无法连接后端服务，请确认 factor-agent-server 已启动（端口 3000）");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code = "HTTP_" + res.status;
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data.error?.message) message = data.error.message;
      if (data.error?.code) code = data.error.code;
    } catch {
      /* 非 JSON 响应，保留默认错误文案 */
    }
    reportClientLog("warn", `接口失败 ${method} ${path} → HTTP ${res.status}`, { code, message });
    /* 登录态失效（非登录接口本身的 AUTH_FAILED）：清 token 并广播，App 切回登录视图 */
    if (res.status === 401 && code !== "AUTH_FAILED") {
      clearToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ----- 健康检查 ----- */

export interface HealthInfo {
  status: string;
  service: string;
  zhipuConfigured: boolean;
  defaultModel: string;
}

export const getHealth = () => http<HealthInfo>("GET", "/health");

/* ----- 会话模块（契约 §3.1） ----- */

/** 发送消息的响应：同一次请求带回用户消息与智能体回复 */
export interface SendMessageResult {
  userMessage: ChatMessage;
  agentMessage: ChatMessage;
}

export const listConversations = () => http<Conversation[]>("GET", "/conversations");
export const createConversation = () => http<Conversation>("POST", "/conversations");
export const deleteConversation = (id: string) => http<void>("DELETE", `/conversations/${id}`);
export const clearConversation = (id: string) => http<Conversation>("POST", `/conversations/${id}/clear`);
export const getMessages = (id: string) => http<ChatMessage[]>("GET", `/conversations/${id}/messages`);
export const sendMessage = (id: string, text: string) =>
  http<SendMessageResult>("POST", `/conversations/${id}/messages`, { text });

/* ----- 发送消息（流式，契约 §3.1 chat/stream） ----- */

/** 流式帧：过程事件 + 终结帧（final 响应体与同步接口完全一致）+ 错误帧 */
export type ChatStreamFrame =
  | ChatProgressEvent
  | { type: "error"; code?: string; message: string }
  | { type: "final"; userMessage: ChatMessage; agentMessage: ChatMessage };

/**
 * 发送消息（SSE 流式）：POST + fetch 读流（EventSource 不支持 POST）。
 * 事件序列 start → tool_call/tool_result* → final；HTTP 恒 200（开流后状态码不可改），
 * 失败以 error 帧收尾（此处抛 ApiError）；中途断开且未收到 final 时抛 AGENT_ERROR，
 * 后端落库不受影响（重开会话可见已持久化的消息）。
 * signal：调用方的"停止生成"取消信号——取消后抛 ABORTED（消息已送达后端，
 * 服务端会继续处理并落库，前端只是不再等待回复）。
 */
export async function sendMessageStream(
  id: string,
  text: string,
  onEvent: (e: ChatProgressEvent) => void,
  signal?: AbortSignal,
): Promise<SendMessageResult> {
  let res: Response;
  const token = getToken();
  // 空闲超时：SSE 流式总时长不定（工具循环可能很久），按"距上次收到数据"计——90s 无数据判死链路
  const controller = new AbortController();
  let userAborted = false;
  if (signal) {
    if (signal.aborted) userAborted = true;
    else signal.addEventListener("abort", () => { userAborted = true; controller.abort(); }, { once: true });
  }
  const IDLE_MS = 90_000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_MS);
  };
  try {
    armIdle();
    res = await fetch(`/api/conversations/${id}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
  } catch (e) {
    if (userAborted) throw new ApiError("ABORTED", "已停止生成");
    const reason = e instanceof DOMException && e.name === "AbortError" ? "timeout" : "network";
    reportClientLog("error", `流式连接失败 POST /conversations/${id}/chat/stream`, { reason });
    if (reason === "timeout") throw new ApiError("TIMEOUT", `连接超时（${IDLE_MS / 1000}s 无响应），请稍后重试`);
    throw new ApiError("NETWORK_ERROR", "无法连接后端服务，请确认 factor-agent-server 已启动（端口 3000）");
  }
  /* 鉴权失败等在开流前被拒：仍是 JSON 错误体，按同步接口的口径处理 */
  if (!res.ok || !res.body) {
    let code = "HTTP_" + res.status;
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data.error?.message) message = data.error.message;
      if (data.error?.code) code = data.error.code;
    } catch {
      /* 非 JSON 响应，保留默认错误文案 */
    }
    reportClientLog("warn", `流式接口失败 POST /conversations/${id}/chat/stream → HTTP ${res.status}`, { code, message });
    if (res.status === 401 && code !== "AUTH_FAILED") {
      clearToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(code, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** final 经闭包赋值，用对象属性承载——局部变量会被 TS 控制流收窄成 never */
  const collected: { final: SendMessageResult | null } = { final: null };

  /** 处理一行 `data: {…}`；final 只记录，error 抛出，其余推给调用方 */
  const handleLine = (line: string): void => {
    if (!line.startsWith("data:")) return;
    let frame: ChatStreamFrame;
    try {
      frame = JSON.parse(line.slice(5).trim()) as ChatStreamFrame;
    } catch {
      return; /* 非 JSON 行（如注释/心跳），忽略 */
    }
    if (frame.type === "final") {
      collected.final = { userMessage: frame.userMessage, agentMessage: frame.agentMessage };
    } else if (frame.type === "error") {
      throw new ApiError(frame.code ?? "AGENT_ERROR", frame.message);
    } else {
      onEvent(frame);
    }
  };

  try {
    for (;;) {
      armIdle(); // 每次读块前重置空闲计时：收到数据即证明链路活着
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        frame.split("\n").forEach(l => handleLine(l.trim()));
      }
    }
    if (buffer.trim()) handleLine(buffer.trim()); // 残包兜底（正常：final 后服务端即结束流）
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      if (userAborted) throw new ApiError("ABORTED", "已停止生成");
      throw new ApiError("TIMEOUT", `连接超时（${IDLE_MS / 1000}s 未收到数据），请稍后重试`);
    }
    throw e;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    reader.cancel().catch(() => {}); // 出错中断时释放连接；正常结束后取消为无害空操作
  }

  const result = collected.final;
  if (!result) throw new ApiError("AGENT_ERROR", "连接中断，未收到完整回复");
  if (result.agentMessage.card) withCardId(result.agentMessage.card);
  return result;
}

/* ----- 策略模块（契约 §3.2） ----- */

/** 新建策略入参（后端创建草稿并补全其余字段） */
export const listStrategies = () => http<Strategy[]>("GET", "/strategies");
export const backtestStrategy = (id: string) => http<Strategy>("POST", `/strategies/${id}/backtest`, {});
export const deleteStrategy = (id: string) => http<void>("DELETE", `/strategies/${id}`);

/** API-27：把回测卡片保存为策略——服务端按 config 重跑真引擎（数字与卡片一致）；
 *  新引擎卡片为 StrategyRunConfig，历史等权卡片为 BacktestRunConfig */
export const createStrategyFromBacktest = (name: string, config: StrategyRunConfig | BacktestRunConfig) =>
  http<Strategy>("POST", "/strategies/from-backtest", { name, config });

/* ----- 行情配置（契约 §3.4 / §3.5，配置型数据由后端下发） ----- */

export const getFactors = () => http<FactorLibItem[]>("GET", "/factors");
export const getBtParams = () => http<{ label: string; value: string; hint: string }[]>("GET", "/backtest-params");

/* ----- 个人中心（契约 §3.6） ----- */

export const getProfile = () => http<UserProfile>("GET", "/user/profile");
/** 更新设置项：toggle 型传 on，single 型（风险偏好）传 value；模型/数据来源为 readonly 不可配置 */
export const updateSetting = (payload: { key: string; on?: boolean; value?: string }) =>
  http<UserProfile>("PATCH", "/user/settings", payload);

/* ----- 登录鉴权（契约 §7，M13） ----- */

/** 用户公开信息（任何接口都不返回密码哈希） */
export interface UserPublic {
  id: number;
  username: string;
  nickname: string;
  createdAt: string;
}

/** 注册/登录成功响应 */
export interface AuthSuccess {
  token: string;
  user: UserPublic;
}

const TOKEN_KEY = "alphasage_token_v1";
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/** token 失效广播：http() 捕获 401 后发，App 监听后切回登录视图 */
export const AUTH_EXPIRED_EVENT = "alphasage:auth-expired";

/** 注册并直接登录（后端返回 token，无需再调 login）；撞名 409 USERNAME_TAKEN */
export const register = (input: { username: string; password: string; nickname?: string }) =>
  http<AuthSuccess>("POST", "/auth/register", input);
/** 登录；失败统一 401 AUTH_FAILED（不区分账号/密码错） */
export const login = (input: { username: string; password: string }) =>
  http<AuthSuccess>("POST", "/auth/login", input);
/** 登出：服务端 token_version +1 使已签发 token 全部失效 */
export const logout = () => http<void>("POST", "/auth/logout");
/** 启动时校验本地 token；返回 { user } */
export const me = () => http<{ user: UserPublic }>("GET", "/auth/me");

/* ----- 卡片 id（会话内标记"已保存"用） ----- */

let cardSeq = 0;

/** 后端卡片不带 id，前端收到后补一个会话内唯一 id，用于"保存为我的策略"的已保存态 */
export function withCardId(card: AgentCard): AgentCard {
  card.id = card.id ?? "ac" + Date.now().toString(36) + ++cardSeq;
  return card;
}
