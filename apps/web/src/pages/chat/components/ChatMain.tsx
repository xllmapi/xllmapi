import { useMemo } from "react";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { ChatEmptyState } from "./ChatEmptyState";
import { getContextLimit } from "@/lib/utils";
import type { Message, CompletionMeta } from "../hooks/useChatStore";

interface ChatMainProps {
  messages: Message[];
  model: string;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRetry: () => void;
  onPromptClick: (text: string) => void;
  streaming: boolean;
  metaMap: Record<string, CompletionMeta>;
}

export function ChatMain({
  messages, model, input, onInputChange,
  onSend, onStop, onRetry, onPromptClick,
  streaming, metaMap,
}: ChatMainProps) {
  const hasMessages = messages.length > 0;

  const contextUsed = useMemo(() => {
    return Math.round(messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / 3.5);
  }, [messages]);

  const contextMax = useMemo(() => {
    return model ? getContextLimit(model) : 0;
  }, [model]);

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
      {hasMessages ? (
        <ChatMessageList
          messages={messages}
          model={model}
          streaming={streaming}
          metaMap={metaMap}
          onRetry={onRetry}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ChatEmptyState
            hasModel={!!model}
            onPromptClick={onPromptClick}
          />
        </div>
      )}

      {/* Floating input — absolute bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <ChatInput
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          onStop={onStop}
          streaming={streaming}
          model={model}
          disabled={!model && messages.length === 0}
          contextUsed={contextUsed}
          contextMax={contextMax}
        />
      </div>
    </main>
  );
}
