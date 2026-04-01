import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "./FormButton";
import { FormInput } from "./FormInput";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (inputValue?: string, inputValues?: Record<string, string>) => void;
  title: string;
  description: string;
  variant?: "warning" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
  cooldownSeconds?: number;
  input?: {
    label: string;
    placeholder?: string;
    type?: string;
  };
  inputs?: Array<{
    key: string;
    label: string;
    placeholder?: string;
    type?: string;
  }>;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  variant = "warning",
  confirmLabel,
  cancelLabel,
  cooldownSeconds = 5,
  input,
  inputs,
}: ConfirmDialogProps) {
  const { t } = useLocale();
  const [countdown, setCountdown] = useState(cooldownSeconds);
  const [inputValue, setInputValue] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Reset countdown and input when dialog opens
  useEffect(() => {
    if (open) {
      setCountdown(cooldownSeconds);
      setInputValue("");
      setInputValues({});
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [open, cooldownSeconds]);

  // Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const isReady = countdown === 0;
  const variantColor =
    variant === "danger" ? "text-danger" : "text-orange-400";
  const variantBg =
    variant === "danger" ? "bg-danger/10" : "bg-orange-400/10";
  const variantBorder =
    variant === "danger" ? "border-danger/30" : "border-orange-400/30";

  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const buttonLabel = isReady
    ? resolvedConfirmLabel
    : `${resolvedConfirmLabel} (${countdown}s)`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Card */}
      <div
        className="relative rounded-[var(--radius-card)] border border-line bg-panel p-6 w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning icon */}
        <div
          className={`w-10 h-10 rounded-full ${variantBg} border ${variantBorder} flex items-center justify-center mb-4`}
        >
          <span className={`text-lg ${variantColor}`}>⚠</span>
        </div>
        {/* Title */}
        <h3 className="text-base font-semibold text-text-primary mb-2">
          {title}
        </h3>
        {/* Description */}
        <p className="text-sm text-text-secondary mb-4">{description}</p>
        {/* Optional single input */}
        {input && !inputs && (
          <div className="mb-4">
            <FormInput
              label={input.label}
              type={input.type ?? "text"}
              placeholder={input.placeholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
        )}
        {/* Optional multi-input */}
        {inputs && (
          <div className="mb-4 flex flex-col gap-3">
            {inputs.map((inp) => (
              <FormInput
                key={inp.key}
                label={inp.label}
                type={inp.type ?? "text"}
                placeholder={inp.placeholder}
                value={inputValues[inp.key] ?? ""}
                onChange={(e) =>
                  setInputValues((prev) => ({ ...prev, [inp.key]: e.target.value }))
                }
              />
            ))}
          </div>
        )}
        {/* Buttons */}
        <div className="flex justify-end gap-3">
          <FormButton variant="ghost" onClick={onClose}>
            {cancelLabel ?? t("common.cancel")}
          </FormButton>
          <FormButton
            variant="primary"
            disabled={
              !isReady ||
              (!!input && !inputs && !inputValue.trim()) ||
              (!!inputs && inputs.length > 0 && !(inputValues[inputs[0]!.key] ?? "").trim())
            }
            onClick={() =>
              inputs
                ? onConfirm(undefined, inputValues)
                : onConfirm(input ? inputValue : undefined)
            }
            className={
              variant === "danger"
                ? "!bg-danger hover:!bg-danger/80 disabled:!bg-danger/30"
                : ""
            }
          >
            {buttonLabel}
          </FormButton>
        </div>
      </div>
    </div>
  );
}
