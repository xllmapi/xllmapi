import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, apiRaw } from "@/lib/api";
import { ModelSelector } from "@/components/shared/ModelSelector";
import { useLocale } from "@/hooks/useLocale";
import Markdown from "react-markdown";

interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export function ChatPage() {
  const { t } = useLocale();
  const [model, setModel] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => scrollToBottom(), [messages]);

  useEffect(() => {
    if (!model) return;
    apiJson<{ data: Conversation[] }>(
      `/v1/chat/conversations?model=${encodeURIComponent(model)}`,
    )
      .then((r) => setConversations(r.data ?? []))
      .catch(() => {});
  }, [model]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    apiJson<{ data: Message[] }>(
      `/v1/chat/conversations/${encodeURIComponent(activeId)}/messages`,
    )
      .then((r) => setMessages(r.data ?? []))
      .catch(() => {});
  }, [activeId]);

  const createConversation = useCallback(async () => {
    if (!model) return;
    const result = await apiJson<{ data: Conversation }>(
      "/v1/chat/conversations",
      { method: "POST", body: JSON.stringify({ model, title: "" }) },
    );
    const conv = result.data;
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setMessages([]);
  }, [model]);

  const deleteConversation = async (id: string) => {
    await apiJson(`/v1/chat/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId("");
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;

    let convId = activeId;
    if (!convId) {
      if (!model) return;
      const result = await apiJson<{ data: Conversation }>(
        "/v1/chat/conversations",
        { method: "POST", body: JSON.stringify({ model, title: "" }) },
      );
      convId = result.data.id;
      setConversations((prev) => [result.data, ...prev]);
      setActiveId(convId);
    }

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: input.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = {
      id: `tmp-assistant-${Date.now()}`,
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const response = await apiRaw(
        `/v1/chat/conversations/${encodeURIComponent(convId)}/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: userMsg.content }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = "Error: " + response.status;
        try { errMsg = JSON.parse(errText).error?.message ?? errMsg; } catch {}
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: errMsg };
          }
          return copy;
        });
        return;
      }

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            // Support both core-router format {"delta":"..."} and OpenAI format
            const delta = parsed.delta ?? parsed.choices?.[0]?.delta?.content;
            if (delta) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = {
                    ...last,
                    content: last.content + delta,
                  };
                }
                return copy;
              });
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content) {
          copy[copy.length - 1] = {
            ...last,
            content: "Error: Failed to get response.",
          };
        }
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="flex" style={{ height: "calc(100vh - 56px)", marginTop: "56px" }}>
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 border-r border-line bg-panel-strong flex flex-col relative z-[60]">
        <div className="p-3 border-b border-line">
          <ModelSelector
            value={model}
            onChange={(m) => { setModel(m); setActiveId(""); }}
            className="w-full"
          />
        </div>
        <div className="p-3">
          <button
            onClick={() => void createConversation()}
            disabled={!model}
            className="w-full rounded-[var(--radius-btn)] bg-accent-bg text-accent text-sm py-2 cursor-pointer border border-accent/20 hover:bg-accent/15 disabled:opacity-50 transition-colors"
          >
            {t("chat.newChat")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                activeId === c.id
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-accent-bg"
              }`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="shrink-0 w-6 h-6 rounded-[var(--radius-avatar)] bg-accent/15 flex items-center justify-center text-accent text-[10px] font-bold">
                {(c.model || "?").charAt(0).toUpperCase()}
              </span>
              <span className="truncate flex-1">
                {c.title || t("chat.untitled")}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id); }}
                className="text-text-tertiary hover:text-danger text-xs cursor-pointer bg-transparent border-none transition-colors shrink-0"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-line">
          <Link
            to="/app"
            className="text-text-tertiary text-xs no-underline hover:text-text-secondary transition-colors"
          >
            {t("chat.backToDashboard")}
          </Link>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              {model ? t("chat.startConversation") : t("chat.selectModel")}
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`mb-4 ${msg.role === "user" ? "text-right" : ""}`}
            >
              <div
                className={`inline-block max-w-[80%] px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-accent/15 text-text-primary rounded-[var(--radius-card)] rounded-br-sm"
                    : "bg-panel border border-line text-text-primary rounded-[var(--radius-card)] rounded-tl-sm"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none [&_pre]:bg-bg-0 [&_pre]:rounded-[var(--radius-input)] [&_pre]:p-3 [&_code]:font-mono [&_code]:text-xs">
                    <Markdown>{msg.content || "…"}</Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-line p-4">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.placeholder")}
              rows={1}
              className="flex-1 resize-none rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || streaming}
              className="rounded-[var(--radius-btn)] bg-accent px-5 py-3 text-sm font-medium text-[#081018] cursor-pointer disabled:opacity-50 shadow-[var(--shadow-cta)] transition-opacity hover:opacity-90"
            >
              {streaming ? "…" : t("chat.send")}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
