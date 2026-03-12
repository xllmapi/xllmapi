import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "warning" | "danger" | "default";

const variants: Record<BadgeVariant, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-accent/10 text-accent border-accent/20",
  danger: "bg-danger/10 text-danger border-danger/20",
  default: "bg-accent-bg text-text-secondary border-line",
};

const statusToVariant: Record<string, BadgeVariant> = {
  approved: "success",
  accepted: "success",
  active: "success",
  pending: "warning",
  rejected: "danger",
  admin: "warning",
};

interface BadgeProps {
  children: string;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant, className }: BadgeProps) {
  const v = variant ?? statusToVariant[children.toLowerCase()] ?? "default";
  return (
    <span
      className={cn(
        "inline-block rounded-[var(--radius-badge)] border px-2.5 py-0.5 text-xs font-medium",
        variants[v],
        className,
      )}
    >
      {children}
    </span>
  );
}
