import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation } from "../types";
import {
  ApiError, clearConversation as apiClear, createConversation as apiCreate,
  deleteConversation as apiRemove, listConversations as apiList,
  sendMessage as apiSend, withCardId,
} from "../api";
import { nowTime } from "../utils/format";

/* 服务端会话标题口径：首条用户消息前 16 字（与后端 renameConversationFromFirstMessage 一致） */
const shortTitle = (text: string) => (text.length > 16 ? text.slice(0, 16) + "…" : text);

/* ==========================================================
   多会话管理 — 数据全部来自后端接口（契约 §3.1），
   刷新/换浏览器不再丢数据（原 localStorage 方案已移除）。
   发送消息采用"乐观插入 + 服务端回执替换"：
   先本地插入用户消息并显示打字动画，接口返回后用服务端的
   userMessage/agentMessage 替换，失败则回滚并提示。
   ========================================================== */
export function useConversations(notify?: (msg: string) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [typingId, setTypingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  /** 每个会话同时只允许一条在途消息 */
  const inFlight = useRef(new Set<string>());

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
    inFlight.current.add(convId);

    try {
      const { userMessage, agentMessage } = await apiSend(convId, text);
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
      setConversations(prev => prev.map(c =>
        c.id === convId
          ? { ...c, messages: c.messages.filter(m => m !== optimistic) }
          : c));
      failMsg(e, "发送失败，请稍后重试");
    } finally {
      inFlight.current.delete(convId);
      setTypingId(prev => (prev === convId ? null : prev));
    }
  };

  return {
    conversations,
    currentId,
    typingId,
    loading,
    createConversation,
    switchConversation,
    deleteConversation,
    clearConversation,
    submit,
  };
}
