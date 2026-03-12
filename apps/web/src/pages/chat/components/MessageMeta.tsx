interface CompletionMeta {
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  timing?: { totalMs: number };
}

interface MessageMetaProps {
  createdAt?: string;
  meta?: CompletionMeta;
}

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MessageMeta({ createdAt, meta }: MessageMetaProps) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-text-tertiary mt-1.5 select-none">
      {createdAt && <span>{relativeTime(createdAt)}</span>}
      {meta?.usage && (
        <>
          <span>·</span>
          <span>{meta.usage.inputTokens} in / {meta.usage.outputTokens} out</span>
        </>
      )}
      {meta?.timing && (
        <>
          <span>·</span>
          <span>{(meta.timing.totalMs / 1000).toFixed(1)}s</span>
        </>
      )}
    </div>
  );
}
