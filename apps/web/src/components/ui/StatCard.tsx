import { type ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  icon?: ReactNode;
  loading?: boolean;
}

export function StatCard({ label, value, icon, loading }: StatCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-text-secondary text-xs mb-2">{label}</p>
          {loading ? (
            <div className="h-7 w-16 rounded bg-line/30 animate-pulse" />
          ) : (
            <p className="text-lg md:text-xl font-heading font-bold tracking-tight truncate">{value}</p>
          )}
        </div>
        {icon && (
          <div className="text-text-tertiary opacity-60">{icon}</div>
        )}
      </div>
    </div>
  );
}
