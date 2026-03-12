import { useCallback, useEffect, useRef } from "react";
import { SendHorizontal, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  model: string;
  disabled?: boolean;
}

export function ChatInput({ input, onInputChange, onSend, onStop, streaming, model, disabled }: ChatInputProps) {
  const { t } = useLocale();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 144) + "px";
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && input.trim()) {
        onSend();
      }
    }
  };

  return (
    <div className="shrink-0 overscroll-contain px-4 pb-8 pt-2 pointer-events-none">
      <div className="max-w-3xl mx-auto pointer-events-auto">
        <div
          className="rounded-2xl border border-line/60 bg-bg-1/80 shadow-[0_-4px_24px_rgba(0,0,0,0.25)] p-3"
          style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
        >
          {/* Textarea + Send/Stop */}
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.placeholder")}
              rows={1}
              disabled={disabled}
              className="flex-1 resize-none appearance-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary caret-accent focus:outline-none disabled:opacity-50"
              style={{ scrollbarWidth: "none" }}
            />
            {streaming ? (
              <button
                onClick={onStop}
                className="w-8 h-8 rounded-full bg-danger/80 text-white flex items-center justify-center cursor-pointer border-none shrink-0 hover:bg-danger transition-colors"
                title={t("chat.stop")}
              >
                <Square className="w-3.5 h-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!input.trim() || disabled}
                className="w-8 h-8 rounded-full bg-accent text-[#081018] flex items-center justify-center cursor-pointer border-none shrink-0 shadow-[var(--shadow-cta)] disabled:opacity-30 hover:opacity-90 transition-opacity"
              >
                <SendHorizontal className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Bottom bar: model tag + hint */}
          <div className="flex items-center justify-between mt-2 px-2">
            {model ? (
              <span className="text-[10px] text-text-tertiary/70 font-medium bg-accent/8 border border-accent/10 rounded-full px-2 py-0.5">
                {model}
              </span>
            ) : (
              <span />
            )}
            <span className="text-[10px] text-text-tertiary/50">{t("chat.input.hint")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
