import { useCallback, useRef, useState } from "react";
import { apiJson, apiRaw } from "@/lib/api";
import { streamResponse } from "./useSseStream";

export interface Conversation {
  id: string;
  title: string;
  model?: string;
  logicalModel?: string;
  lastMessage?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

export interface CompletionMeta {
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  timing?: { totalMs: number };
}

function truncateTitle(text: string, max = 30): string {
  const clean = text.replace(/\n/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function useChatStore() {
  const [model, setModel] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, _setActiveId] = useState("");
  const [messages, _setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaMap, _setMetaMap] = useState<Record<string, CompletionMeta>>({});

  // Refs for latest values — avoids stale closures in async callbacks
  const activeIdRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const streamingConvRef = useRef(""); // which conversation is being streamed

  // Per-conversation caches (source of truth during streaming)
  const msgCacheRef = useRef<Record<string, Message[]>>({});
  const metaCacheRef = useRef<Record<string, Record<string, CompletionMeta>>>({});

  // Keep ref in sync
  activeIdRef.current = activeId;

  // --- helpers to update display only if target === active ---
  const syncDisplay = useCallback((convId: string) => {
    if (activeIdRef.current === convId) {
      _setMessages(msgCacheRef.current[convId] ?? []);
      _setMetaMap(metaCacheRef.current[convId] ?? {});
    }
  }, []);

  // --- loadConversations --- (load all, no model filter)
  const loadConversations = useCallback(async (_m?: string) => {
    try {
      const r = await apiJson<{ data: Conversation[] }>(
        `/v1/chat/conversations?limit=100`
      );
      setConversations(r.data ?? []);
    } catch { /* ignore */ }
  }, []);

  // --- loadMessages ---
  const loadMessages = useCallback(async (convId: string) => {
    if (!convId) { _setMessages([]); return; }
    // Don't overwrite if this conversation is currently streaming
    if (streamingConvRef.current === convId) {
      _setMessages(msgCacheRef.current[convId] ?? []);
      _setMetaMap(metaCacheRef.current[convId] ?? {});
      return;
    }
    // If we already have cached messages (from this session), use them
    // This prevents server data (which may have empty assistant content) from overwriting
    const cached = msgCacheRef.current[convId];
    if (cached && cached.length > 0) {
      if (activeIdRef.current === convId) {
        _setMessages(cached);
        _setMetaMap(metaCacheRef.current[convId] ?? {});
      }
      return;
    }
    // No cache — fetch from server
    try {
      const r = await apiJson<{ data: Message[] }>(
        `/v1/chat/conversations/${encodeURIComponent(convId)}/messages`
      );
      const msgs = r.data ?? [];
      msgCacheRef.current[convId] = msgs;
      if (activeIdRef.current === convId) {
        _setMessages(msgs);
        _setMetaMap(metaCacheRef.current[convId] ?? {});
      }
    } catch { /* ignore */ }
  }, []);

  // --- setActiveId (with cache save/restore) ---
  const setActiveId = useCallback((newId: string) => {
    _setActiveId(newId);
    activeIdRef.current = newId;

    // Restore from cache or clear
    _setMessages(msgCacheRef.current[newId] ?? []);
    _setMetaMap(metaCacheRef.current[newId] ?? {});

    // Show streaming indicator if this conversation is being streamed
    setStreaming(streamingConvRef.current === newId && newId !== "");
  }, []);

  // --- createConversation ---
  const createConversation = useCallback(async (): Promise<string | null> => {
    if (!model) return null;
    const result = await apiJson<{ data: Conversation }>(
      "/v1/chat/conversations",
      { method: "POST", body: JSON.stringify({ model, title: "" }) },
    );
    const conv = result.data;
    setConversations((prev) => [conv, ...prev]);
    msgCacheRef.current[conv.id] = [];
    metaCacheRef.current[conv.id] = {};
    setActiveId(conv.id);
    return conv.id;
  }, [model, setActiveId]);

  // --- deleteConversation ---
  const deleteConversation = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    delete msgCacheRef.current[id];
    delete metaCacheRef.current[id];
    if (activeIdRef.current === id) {
      setActiveId("");
    }
    // If deleting a conversation that's streaming, abort it
    if (streamingConvRef.current === id) {
      abortRef.current?.abort();
      abortRef.current = null;
      streamingConvRef.current = "";
      setStreaming(false);
    }
    try {
      await apiJson(`/v1/chat/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch { /* ignore */ }
  }, [setActiveId]);

  // --- renameConversation ---
  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
    try {
      await apiJson(`/v1/chat/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
    } catch { /* ignore */ }
  }, []);

  // --- stopGeneration ---
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingConvRef.current = "";
    setStreaming(false);
  }, []);

  // --- sendMessage ---
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    // Don't block if another conversation is streaming — only block same-conversation double send
    if (streamingConvRef.current === activeIdRef.current && streamingConvRef.current !== "") return;
    setError(null);

    let convId = activeIdRef.current;
    if (!convId) {
      if (!model) return;
      const result = await apiJson<{ data: Conversation }>(
        "/v1/chat/conversations",
        { method: "POST", body: JSON.stringify({ model, title: "" }) },
      );
      convId = result.data.id;
      msgCacheRef.current[convId] = [];
      metaCacheRef.current[convId] = {};
      setConversations((prev) => [result.data, ...prev]);
      _setActiveId(convId);
      activeIdRef.current = convId;
    }

    // --- Immediate title for new/untitled conversations ---
    setConversations((prev) => {
      const conv = prev.find((c) => c.id === convId);
      if (conv && !conv.title) {
        const title = truncateTitle(content);
        // Fire-and-forget PATCH to persist
        void apiJson(`/v1/chat/conversations/${encodeURIComponent(convId)}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        }).catch(() => {});
        return prev.map((c) => (c.id === convId ? { ...c, title } : c));
      }
      return prev;
    });

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    const assistantMsgId = `tmp-assistant-${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    // Write to cache
    const cached = msgCacheRef.current[convId] ?? [];
    msgCacheRef.current[convId] = [...cached, userMsg, assistantMsg];
    if (!metaCacheRef.current[convId]) metaCacheRef.current[convId] = {};

    // Update display if this is the active conversation
    if (activeIdRef.current === convId) {
      _setMessages(msgCacheRef.current[convId]!);
      setStreaming(true);
    }
    setInput("");

    streamingConvRef.current = convId;
    const controller = new AbortController();
    abortRef.current = controller;

    const updateAssistant = (updater: (msg: Message) => Message) => {
      const msgs = msgCacheRef.current[convId];
      if (!msgs) return;
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = updater(last);
        msgCacheRef.current[convId] = [...msgs];
        syncDisplay(convId);
      }
    };

    try {
      const response = await apiRaw(
        `/v1/chat/conversations/${encodeURIComponent(convId)}/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: userMsg.content }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = "Error: " + response.status;
        try { errMsg = JSON.parse(errText).error?.message ?? errMsg; } catch { /* ignore */ }

        // If model not available, don't pollute conversation history
        const isModelUnavailable = errMsg.toLowerCase().includes("no offering") || errMsg.toLowerCase().includes("no model");
        if (isModelUnavailable) {
          // Roll back the temp messages we just added
          const msgs = msgCacheRef.current[convId];
          if (msgs) {
            msgCacheRef.current[convId] = msgs.filter(
              (m) => m.id !== userMsg.id && m.id !== assistantMsgId
            );
            syncDisplay(convId);
          }
          setError("MODEL_UNAVAILABLE:" + (model || "unknown"));
          return;
        }

        updateAssistant((msg) => ({ ...msg, content: errMsg }));
        setError(errMsg);
        return;
      }

      await streamResponse(
        response,
        (delta) => {
          updateAssistant((msg) => ({ ...msg, content: msg.content + delta }));
        },
        (event) => {
          if (!metaCacheRef.current[convId]) metaCacheRef.current[convId] = {};
          metaCacheRef.current[convId]![assistantMsgId] = {
            usage: event.usage,
            timing: event.timing,
          };
          syncDisplay(convId);
          void loadConversations(model);
        },
        (errMsg) => {
          updateAssistant((msg) =>
            msg.content ? msg : { ...msg, content: "Error: " + errMsg }
          );
          setError(errMsg);
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      updateAssistant((msg) =>
        msg.content ? msg : { ...msg, content: "Error: Failed to get response." }
      );
    } finally {
      if (streamingConvRef.current === convId) {
        streamingConvRef.current = "";
        abortRef.current = null;
        // If user is still viewing this conversation, clear streaming
        if (activeIdRef.current === convId) {
          setStreaming(false);
        }
      }
    }
  }, [model, loadConversations, syncDisplay]);

  // --- retryLastMessage ---
  const retryLastMessage = useCallback(() => {
    const convId = activeIdRef.current;
    const msgs = msgCacheRef.current[convId] ?? [];
    const lastUserIdx = [...msgs].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const idx = msgs.length - 1 - lastUserIdx;
    const userContent = msgs[idx]!.content;

    // Remove failed messages after the user message
    msgCacheRef.current[convId] = msgs.slice(0, idx);
    _setMessages(msgCacheRef.current[convId]);
    void sendMessage(userContent);
  }, [sendMessage]);

  return {
    model, setModel,
    conversations, setConversations,
    activeId, setActiveId,
    messages,
    input, setInput,
    streaming,
    error, setError,
    metaMap,
    loadConversations,
    loadMessages,
    createConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stopGeneration,
    retryLastMessage,
  };
}
