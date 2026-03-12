import { MessageSquare } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

interface ChatEmptyStateProps {
  hasModel: boolean;
  onPromptClick: (text: string) => void;
}

export function ChatEmptyState({ hasModel, onPromptClick }: ChatEmptyStateProps) {
  const { t } = useLocale();

  if (!hasModel) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        {t("chat.selectModel")}
      </div>
    );
  }

  const prompts = [
    t("chat.prompt1"),
    t("chat.prompt2"),
    t("chat.prompt3"),
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div className="mb-4" style={{ filter: "drop-shadow(0 0 40px rgba(139,227,218,0.15))" }}>
        <MessageSquare className="w-12 h-12 text-accent" />
      </div>
      <h2 className="font-heading text-xl text-text-primary mb-2 tracking-tight">
        {t("chat.welcome.title")}
      </h2>
      <p className="text-sm text-text-secondary mb-8 max-w-md text-center">
        {t("chat.welcome.subtitle")}
      </p>
      <div className="flex flex-col gap-3 w-full max-w-md">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="border border-line rounded-[var(--radius-card)] px-4 py-3 text-sm text-text-secondary text-left cursor-pointer bg-transparent hover:border-accent/30 hover:bg-accent-bg transition-all"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
