/* ==========================================================
   后端 API 统一封装 — 所有对后端的访问都从这里走
   联调期经 Vite 代理（vite.config.ts 里 /api → http://localhost:3000），
   生产期同域部署时无需改动。
   错误格式按契约：{ "error": { "code", "message" } }
   ========================================================== */
import type {
  AgentCard,
  ChatMessage,
  Conversation,
  FactorLibItem,
  FactorWeight,
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

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "无法连接后端服务，请确认 factor-agent-server 已启动（端口 3000）");
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

/* ----- 策略模块（契约 §3.2） ----- */

/** 新建策略入参（后端创建草稿并补全其余字段） */
export interface NewStrategyInput {
  name: string;
  universe?: string;
  rebalance?: string;
  benchmark?: string;
  factors: FactorWeight[];
}

export const listStrategies = () => http<Strategy[]>("GET", "/strategies");
export const createStrategy = (input: NewStrategyInput) => http<Strategy>("POST", "/strategies", input);
/** 更新配置 = 保存并自动重新回测（契约：同一动作） */
export const updateStrategy = (id: string, patch: Partial<NewStrategyInput>) =>
  http<Strategy>("PATCH", `/strategies/${id}`, patch);
export const backtestStrategy = (id: string) => http<Strategy>("POST", `/strategies/${id}/backtest`, {});
export const deleteStrategy = (id: string) => http<void>("DELETE", `/strategies/${id}`);

/* ----- 行情配置（契约 §3.4 / §3.5，配置型数据由后端下发） ----- */

export const getFactors = () => http<FactorLibItem[]>("GET", "/factors");
export const getBtParams = () => http<{ label: string; value: string; hint: string }[]>("GET", "/backtest-params");

/* ----- 个人中心（契约 §3.6） ----- */

export const getProfile = () => http<UserProfile>("GET", "/user/profile");
/** 更新设置项：toggle 型传 on，single 型传 value，multi 型传 values */
export const updateSetting = (payload: { key: string; on?: boolean; value?: string; values?: string[] }) =>
  http<UserProfile>("PATCH", "/user/settings", payload);
export const addApiKey = (name: string, key: string) =>
  http<UserProfile>("POST", "/user/apikeys", { name, key });
export const removeApiKey = (name: string) =>
  http<UserProfile>("DELETE", `/user/apikeys/${encodeURIComponent(name)}`);

/* ----- 卡片 id（会话内标记"已保存"用） ----- */

let cardSeq = 0;

/** 后端卡片不带 id，前端收到后补一个会话内唯一 id，用于"保存为我的策略"的已保存态 */
export function withCardId(card: AgentCard): AgentCard {
  card.id = card.id ?? "ac" + Date.now().toString(36) + ++cardSeq;
  return card;
}
