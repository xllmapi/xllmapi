import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-[#081018] font-semibold shadow-[var(--shadow-cta)] hover:opacity-90",
  ghost:
    "bg-accent-bg border border-accent/20 text-accent hover:bg-accent/15",
  danger:
    "bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20",
};

interface FormButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function FormButton({
  variant = "primary",
  className,
  children,
  ...props
}: FormButtonProps) {
  return (
    <button
      className={cn(
        "rounded-[var(--radius-btn)] px-5 py-2.5 text-sm font-medium cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
