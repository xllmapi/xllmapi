import { type ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-text-secondary text-xs mb-2">{label}</p>
          <p className="text-xl font-heading font-bold tracking-tight">{value}</p>
        </div>
        {icon && (
          <div className="text-text-tertiary opacity-60">{icon}</div>
        )}
      </div>
    </div>
  );
}
