import { useEffect, useState, useCallback } from "react";
import { useLocale } from "@/hooks/useLocale";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  countdown?: number;
  variant?: "danger" | "warning";
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmText,
  cancelText,
  countdown = 5,
  variant = "danger",
}: ConfirmDialogProps) {
  const { t } = useLocale();
  const [remaining, setRemaining] = useState(countdown);

  useEffect(() => {
    if (!open) {
      setRemaining(countdown);
      return;
    }
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [open, remaining, countdown]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const confirmLabel =
    remaining > 0
      ? `${confirmText ?? t("common.confirm")} (${remaining}s)`
      : (confirmText ?? t("common.confirm"));

  const variantStyles =
    variant === "danger"
      ? "bg-danger/10 border-danger/20 text-danger hover:bg-danger/20"
      : "bg-amber-500/10 border-amber-500/20 text-amber-500 hover:bg-amber-500/20";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-panel p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary mb-2">
          {title}
        </h3>
        <p className="text-sm text-text-secondary mb-6 leading-relaxed">
          {description}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-[var(--radius-btn)] px-5 py-2.5 text-sm font-medium cursor-pointer bg-accent-bg border border-accent/20 text-accent hover:bg-accent/15 transition-all"
          >
            {cancelText ?? t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={remaining > 0}
            className={`rounded-[var(--radius-btn)] px-5 py-2.5 text-sm font-medium cursor-pointer border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
