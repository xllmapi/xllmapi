import { useState } from "react";
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
  isStreaming?: boolean;
  onRetry?: () => void;
}

/** Split content into {thinking, answer}. Handles streaming (unclosed tag). */
function parseThinking(content: string): { thinking: string; answer: string; isThinking: boolean } {
  const openTag = "<think>";
  const closeTag = "</think>";

  const openIdx = content.indexOf(openTag);
  if (openIdx === -1) return { thinking: "", answer: content, isThinking: false };

  const afterOpen = openIdx + openTag.length;
  const closeIdx = content.indexOf(closeTag, afterOpen);

  if (closeIdx === -1) {
    // Still streaming the thinking part — tag not closed yet
    return { thinking: content.slice(afterOpen), answer: "", isThinking: true };
  }

  const thinking = content.slice(afterOpen, closeIdx).trim();
  const answer = (content.slice(0, openIdx) + content.slice(closeIdx + closeTag.length)).trim();
  return { thinking, answer, isThinking: false };
}

function ThinkingBlock({ thinking, isThinking }: { thinking: string; isThinking: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const showExpanded = expanded || isThinking;

  if (!thinking) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer bg-transparent border-none p-0"
      >
        <span
          className="inline-block transition-transform duration-200"
          style={{ transform: showExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        {isThinking ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-text-tertiary/40 border-t-text-tertiary rounded-full animate-spin" />
            思考中…
          </span>
        ) : (
          <span>思考过程</span>
        )}
      </button>
      {showExpanded && (
        <div className="mt-2 pl-3 border-l-2 border-text-tertiary/20 text-text-tertiary text-xs leading-relaxed max-h-[300px] overflow-y-auto">
          <div className="whitespace-pre-wrap">{thinking}</div>
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message, model, meta, isError, isStreaming, onRetry }: ChatMessageProps) {
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

  // Assistant message — split thinking from answer
  const hasError = isError || message.content.startsWith("Error:");
  const { thinking, answer, isThinking } = parseThinking(message.content);
  const displayContent = thinking ? answer : message.content;

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
            {/* Thinking block (collapsible) */}
            {thinking && <ThinkingBlock thinking={thinking} isThinking={isThinking} />}

            {/* Answer content */}
            {(displayContent || (!thinking && !isThinking)) && (
              <div className="chat-prose">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    code: ({ className, children }) => (
                      <CodeBlock className={className} isStreaming={isStreaming}>{children}</CodeBlock>
                    ),
                    pre: ({ children }) => <>{children}</>,
                  }}
                >
                  {displayContent || "…"}
                </Markdown>
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <MessageMeta createdAt={message.createdAt} meta={meta} />
              {message.content && (
                <CopyButton
                  text={answer || message.content}
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
