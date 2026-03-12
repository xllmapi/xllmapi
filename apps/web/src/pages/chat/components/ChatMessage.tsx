import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark-dimmed.min.css";
import { CodeBlock } from "./CodeBlock";
import { MessageMeta } from "./MessageMeta";
import { CopyButton } from "@/components/ui/CopyButton";
import { useLocale } from "@/hooks/useLocale";
import type { Message, CompletionMeta } from "../hooks/useChatStore";

interface ChatMessageProps {
  message: Message;
  model?: string;
  meta?: CompletionMeta;
  isError?: boolean;
  onRetry?: () => void;
}

export function ChatMessage({ message, model, meta, isError, onRetry }: ChatMessageProps) {
  const { t } = useLocale();

  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%]">
          <div className="bg-accent/12 text-text-primary rounded-[16px] rounded-br-[4px] px-4 py-3">
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
          </div>
          <MessageMeta createdAt={message.createdAt} />
        </div>
      </div>
    );
  }

  // Assistant message
  const hasError = isError || message.content.startsWith("Error:");

  return (
    <div className="flex gap-3 mb-4">
      {/* Avatar */}
      <div className="shrink-0 w-7 h-7 rounded-[var(--radius-avatar)] bg-accent/15 flex items-center justify-center text-accent text-[11px] font-bold mt-0.5">
        {(model || "A").charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        {/* Model label */}
        <div className="text-xs text-text-secondary font-medium mb-1">
          {model || "Assistant"}
        </div>

        {hasError ? (
          <div className="bg-danger/10 border border-danger/20 rounded-[var(--radius-card)] p-4">
            <p className="text-sm text-danger mb-2">{message.content}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs text-danger border border-danger/30 rounded-[var(--radius-btn)] px-3 py-1 cursor-pointer bg-transparent hover:bg-danger/10 transition-colors"
              >
                {t("chat.retry")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="chat-prose">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  code: ({ className, children }) => (
                    <CodeBlock className={className}>{children}</CodeBlock>
                  ),
                  pre: ({ children }) => <>{children}</>,
                }}
              >
                {message.content || "…"}
              </Markdown>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <MessageMeta createdAt={message.createdAt} meta={meta} />
              {message.content && (
                <CopyButton
                  text={message.content}
                  label={t("chat.copyMessage")}
                  copiedLabel="✓"
                  className="!px-2 !py-0.5 !text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
