import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation } from "../types";
import {
  ApiError, clearConversation as apiClear, createConversation as apiCreate,
  deleteConversation as apiRemove, getMessages as apiMessages, getRunStatus as apiRunStatus,
  listConversations as apiList, reportClientLog, sendMessageStream as apiSendStream, withCardId,
} from "../api";
import { nowTime } from "../utils/format";

/* 服务端会话标题口径：首条用户消息前 16 字（与后端 renameConversationFromFirstMessage 一致） */
const shortTitle = (text: string) => (text.length > 16 ? text.slice(0, 16) + "…" : text);

/** 在途会话的过程步骤（SSE 节点级事件）：stage 为工具中文名，ok 缺省 = 进行中；
 *  detail 为该步的内容摘要（引擎分批上报：第 x/y 批 · N 只 / 已完成 M/K 个调仓日） */
export interface LiveProgress {
  convId: string;
  steps: { stage: string; ok?: boolean; detail?: string }[];
}

/** 确认门挂起（confirm_pending 事件的落地态）：只在收到事件的当轮有效——
 *  同会话下一轮发送即清除；刷新后无事件、不弹窗（历史里的确认提案只是普通消息） */
export interface ConfirmGatePending {
  convId: string;
  kind: "backtest" | "analysis";
  params: Record<string, string>;
}

/* ==========================================================
   多会话管理 — 数据全部来自后端接口（契约 §3.1），
   刷新/换浏览器不再丢数据（原 localStorage 方案已移除）。
   发送消息采用"乐观插入 + 服务端回执替换"：
   先本地插入用户消息并显示打字动画，流式接口逐个推过程步骤
   （正在查看数据表/因子字段…），final 返回后用服务端的
   userMessage/agentMessage 替换，失败则回滚并提示。
   ========================================================== */
export function useConversations(notify?: (msg: string) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [typingId, setTypingId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveProgress | null>(null);
  const [confirmGate, setConfirmGate] = useState<ConfirmGatePending | null>(null);
  const [loading, setLoading] = useState(true);
  /** 在跑轮次（后端仍在执行、尚未落库的会话）：刷新后据此显示"后台执行中"占位 */
  const [backendBusyId, setBackendBusyId] = useState<string | null>(null);

  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  /** 每个会话同时只允许一条在途消息 */
  const inFlight = useRef(new Set<string>());
  /** 在途消息的取消句柄（停止生成按钮用），convId → AbortController */
  const stops = useRef(new Map<string, AbortController>());
  /** 会话列表镜像：后台轮询回调里读最新消息数，避开 effect 闭包旧值 */
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  /** 在跑轮次轮询的取消句柄：本地开始新一轮发送时作废轮询（本地流接管真相源） */
  const busyPollCancel = useRef<null | (() => void)>(null);

  const failMsg = (e: unknown, fallback: string) =>
    notifyRef.current?.(e instanceof ApiError ? e.message : fallback);

  /* 首次加载：拉会话列表；后端为空则自动新建（新会话自带欢迎语） */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list = await apiList();
        if (!list.length) list = [await apiCreate()];
        if (cancelled) return;
        setConversations(list);
        setCurrentId(list[0].id);
      } catch (e) {
        if (!cancelled) failMsg(e, "会话加载失败，请确认后端服务已启动");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* 在跑轮次恢复：轮次落库在整轮结束时一次性写入，刷新时正在执行的那轮不在任何
   * 历史接口里。挂载/换会话时查一次运行状态——在跑则显示"后台执行中"占位并轮询，
   * 收尾后把落库结果合并回会话（服务端为真相源，整段替换该会话消息） */
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    let timer: number | undefined;
    const sleep = (ms: number) => new Promise<void>(r => { timer = window.setTimeout(r, ms); });
    const stop = () => { cancelled = true; window.clearTimeout(timer); };
    busyPollCancel.current = stop;

    const mergeIfLonger = (fresh: ChatMessage[]): boolean => {
      const local = conversationsRef.current.find(c => c.id === currentId);
      if (!local || fresh.length <= local.messages.length) return false;
      setConversations(prev => prev.map(c => (c.id === currentId ? { ...c, messages: fresh } : c)));
      return true;
    };

    (async () => {
      let running = false;
      try {
        ({ running } = await apiRunStatus(currentId));
      } catch {
        return; // 会话被删（404）/网络错误：无法判定，不占位（下次刷新自愈）
      }
      if (cancelled) return;
      if (running) {
        setBackendBusyId(currentId);
        /* 兜底：后端异常长跑最多等 5 分钟，避免无限轮询 */
        const deadline = Date.now() + 5 * 60_000;
        while (!cancelled) {
          if (Date.now() > deadline) {
            setBackendBusyId(null);
            notifyRef.current?.("后台执行时间较长，已停止等待；结果落库后刷新页面即可看到");
            return;
          }
          await sleep(2500);
          if (cancelled) return;
          try {
            if (!(await apiRunStatus(currentId)).running) break;
          } catch {
            return;
          }
        }
        if (cancelled) return;
      }
      /* 收尾补拉：闸先删、persist 后写（毫秒级迟滞），观察到过在跑的容忍 3 次；无新行即放弃 */
      const retries = running ? 3 : 1;
      for (let i = 0; i < retries && !cancelled; i++) {
        try {
          if (mergeIfLonger(await apiMessages(currentId))) {
            setBackendBusyId(id => (id === currentId ? null : id));
            return;
          }
        } catch {
          return;
        }
        if (i < retries - 1) await sleep(1500);
      }
      if (!cancelled) setBackendBusyId(id => (id === currentId ? null : id));
    })();

    return () => { stop(); busyPollCancel.current = null; };
  }, [currentId]);

  const createConversation = async () => {
    try {
      const c = await apiCreate();
      setConversations(prev => [c, ...prev]);
      setCurrentId(c.id);
    } catch (e) {
      failMsg(e, "新建对话失败");
    }
  };

  const switchConversation = (id: string) => setCurrentId(id);

  const deleteConversation = async (id: string) => {
    try {
      await apiRemove(id);
    } catch (e) {
      failMsg(e, "删除对话失败");
      return;
    }
    const rest = conversations.filter(c => c.id !== id);
    if (!rest.length) {
      /* 删空后自动建一个新会话，保证聊天页始终有会话可用 */
      setConversations([]);
      try {
        const c = await apiCreate();
        setConversations([c]);
        setCurrentId(c.id);
      } catch (e) {
        failMsg(e, "新建对话失败");
      }
      return;
    }
    setConversations(rest);
    if (id === currentId) setCurrentId(rest[0].id);
  };

  const clearConversation = async (id: string) => {
    try {
      const c = await apiClear(id);
      setConversations(prev => prev.map(x => (x.id === id ? c : x)));
    } catch (e) {
      failMsg(e, "清空对话失败");
    }
  };

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const convId = currentId;
    if (!convId || inFlight.current.has(convId)) return;
    /* 本地新一轮接管真相源：作废在跑轮次的后台轮询与占位（避免补拉整段替换冲掉乐观消息） */
    busyPollCancel.current?.();
    setBackendBusyId(id => (id === convId ? null : id));

    /* 乐观插入：用户消息先上屏（保留对象引用，失败时按引用回滚） */
    const optimistic: ChatMessage = { role: "user", bubble: text, time: nowTime() };
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? {
            ...c,
            title: c.title === "新对话" ? shortTitle(text) : c.title,
            updatedAt: Date.now(),
            messages: [...c.messages, optimistic],
          }
        : c));
    setTypingId(convId);
    setLive({ convId, steps: [] });
    /* 新一轮开始即作废上一轮的确认门（本轮若再次挂起，confirm_pending 会重新置上） */
    setConfirmGate(g => (g && g.convId === convId ? null : g));
    inFlight.current.add(convId);

    const startedAt = Date.now();
    const stopCtl = new AbortController();
    stops.current.set(convId, stopCtl);
    try {
      const { userMessage, agentMessage } = await apiSendStream(convId, text, ev => {
        if (ev.type === "start") {
          setLive({ convId, steps: [] });
        } else if (ev.type === "tool_call") {
          setLive(p => {
            if (!p || p.convId !== convId) return p;
            const steps = [...p.steps];
            const last = steps[steps.length - 1];
            // 引擎分批上报（第 1/5 批 → 第 2/5 批）：同名阶段原地滚动更新，不堆叠同名行
            if (last && last.stage === ev.stage) {
              steps[steps.length - 1] = { stage: ev.stage, detail: ev.args };
            } else {
              steps.push({ stage: ev.stage, detail: ev.args });
            }
            return { ...p, steps };
          });
        } else if (ev.type === "confirm_pending") {
          setConfirmGate({ convId, kind: ev.kind, params: ev.params });
        } else if (ev.type === "tool_result") {
          setLive(p => {
            if (!p || p.convId !== convId) return p;
            const steps = [...p.steps];
            // 同一工具可能多次调用：从后往前找最近的未定案步骤标记成功/失败，并写入完成摘要
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].stage === ev.stage && steps[i].ok === undefined) {
                steps[i] = { ...steps[i], ok: ev.ok, detail: ev.detail || steps[i].detail };
                break;
              }
            }
            return { ...p, steps };
          });
        }
      }, stopCtl.signal);
      if (agentMessage.card) withCardId(agentMessage.card);
      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const messages = [...c.messages];
        const idx = messages.lastIndexOf(optimistic);
        messages.splice(idx, 1, userMessage, agentMessage);
        return { ...c, updatedAt: Date.now(), messages };
      }));
      /* 与服务端排序口径一致：最近活跃的会话排最前 */
      setConversations(prev => {
        const cur = prev.find(c => c.id === convId);
        return cur ? [cur, ...prev.filter(c => c.id !== convId)] : prev;
      });
    } catch (e) {
      /* 消息已送达后端、服务端会继续处理并落库的两类断连：用户主动停止、空闲超时
       * （后端 keepalive 落地后，超时≈链路真死，但执行结果仍可能已落库）
       * ——都不回滚乐观消息，避免"发过的消息从界面上消失" */
      if (e instanceof ApiError && (e.code === "ABORTED" || e.code === "TIMEOUT")) {
        notifyRef.current?.(
          e.code === "ABORTED"
            ? "已停止生成；这条回复稍后可能仍会出现在会话中"
            : "连接超时，但这条消息已送达、服务端仍在处理，结果稍后会出现在会话中（无需重发）",
        );
        return;
      }
      setConversations(prev => prev.map(c =>
        c.id === convId
          ? { ...c, messages: c.messages.filter(m => m !== optimistic) }
          : c));
      // 失败上下文上报告前端日志文件（不上报消息内容——隐私）
      reportClientLog("error", "发送消息失败", {
        convId,
        code: e instanceof ApiError ? e.code : "UNKNOWN",
        message: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
        textLength: text.length,
        elapsedMs: Date.now() - startedAt,
      });
      failMsg(e, "发送失败，请稍后重试");
    } finally {
      inFlight.current.delete(convId);
      stops.current.delete(convId);
      setTypingId(prev => (prev === convId ? null : prev));
      setLive(p => (p && p.convId === convId ? null : p));
    }
  };

  /** 停止当前会话的流式生成（消息已送达，仅取消前端等待） */
  const stop = (convId: string) => { stops.current.get(convId)?.abort(); };

  return {
    conversations,
    currentId,
    typingId,
    live,
    confirmGate,
    loading,
    backendBusyId,
    createConversation,
    switchConversation,
    deleteConversation,
    clearConversation,
    submit,
    stop,
  };
}
