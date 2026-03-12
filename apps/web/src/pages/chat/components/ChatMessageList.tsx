import { useEffect, useRef } from "react";
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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-32">
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
    </div>
  );
}
