import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessage } from "./ChatMessage";
import { TypingIndicator } from "./TypingIndicator";
import type { Message, CompletionMeta } from "../hooks/useChatStore";

interface ChatMessageListProps {
  messages: Message[];
  model: string;
  streaming: boolean;
  metaMap: Record<string, CompletionMeta>;
  onRetry: () => void;
}

export function ChatMessageList({ messages, model, streaming, metaMap, onRetry }: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isAutoScrolling = useRef(false);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback(() => {
    isAutoScrolling.current = true;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => { isAutoScrolling.current = false; }, 100);
  }, []);

  // Detect user scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (isAutoScrolling.current) return;
      setUserScrolledUp(!isNearBottom());
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isNearBottom]);

  // Auto-scroll on new content only if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom();
    }
  }, [messages, userScrolledUp, scrollToBottom]);

  // When streaming starts, reset scroll lock so new response auto-scrolls
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (streaming && !prevStreaming.current) {
      setUserScrolledUp(false);
    }
    prevStreaming.current = streaming;
  }, [streaming]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-32 relative">
      <div className="max-w-3xl mx-auto">
        {messages.map((msg, idx) => (
          <div key={msg.id} className="group">
            <ChatMessage
              message={msg}
              model={model}
              meta={metaMap[msg.id]}
              isError={msg.role === "assistant" && msg.content.startsWith("Error:")}
              onRetry={
                msg.role === "assistant" &&
                msg.content.startsWith("Error:") &&
                idx === messages.length - 1
                  ? onRetry
                  : undefined
              }
            />
          </div>
        ))}
        {streaming && <TypingIndicator />}
        <div ref={endRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {userScrolledUp && (
        <button
          type="button"
          onClick={() => { setUserScrolledUp(false); scrollToBottom(); }}
          className="fixed bottom-28 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full border border-line bg-panel/90 backdrop-blur px-4 py-2 text-xs text-text-secondary shadow-lg hover:text-text-primary hover:border-accent/30 transition-colors cursor-pointer"
        >
          <span>↓</span>
          <span>{streaming ? "跟随输出" : "回到底部"}</span>
        </button>
      )}
    </div>
  );
}
