interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-panel px-6 py-16 text-center">
      <div className="text-text-tertiary text-3xl mb-3 opacity-40">∅</div>
      <p className="text-text-tertiary text-sm">{message}</p>
    </div>
  );
}
