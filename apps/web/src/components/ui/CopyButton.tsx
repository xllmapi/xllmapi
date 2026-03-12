import { useState, useCallback } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

export function CopyButton({ text, label = "Copy", copiedLabel = "Copied!", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={() => void handleCopy()}
      className={`rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium cursor-pointer transition-all ${
        copied
          ? "bg-success/10 text-success border border-success/20"
          : "bg-accent-bg text-accent border border-accent/20 hover:bg-accent/15"
      } ${className ?? ""}`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
