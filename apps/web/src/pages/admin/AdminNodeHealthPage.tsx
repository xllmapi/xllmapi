import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { Badge } from "@/components/ui/Badge";
import { FormButton } from "@/components/ui/FormButton";

interface OfferingHealth {
  offeringId: string;
  logicalModel: string;
  realModel: string;
  enabled: boolean;
  executionMode: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  providerType: string;
  providerLabel: string | null;
  dailyTokenLimit: number | null;
  maxConcurrency: number | null;
  // Breaker state
  breakerState: "closed" | "open" | "half-open" | "disabled";
  errorClass: string | null;
  failures: number;
  cooldownMs: number;
  lastFailureAt: string | null;
  lastErrorMessage: string | null;
  autoDisabled: boolean;
}

const STATE_BADGE: Record<string, { variant: "success" | "danger" | "warning" | "default"; label: string }> = {
  closed: { variant: "success", label: "Healthy" },
  "half-open": { variant: "warning", label: "Probing" },
  open: { variant: "danger", label: "Open" },
  disabled: { variant: "danger", label: "Disabled" },
};

function formatCooldown(ms: number): string {
  if (ms <= 0) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function AdminNodeHealthPage() {
  const { t } = useLocale();
  const [data, setData] = useState<OfferingHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiJson<{ data: OfferingHealth[] }>("/v1/admin/offering-health")
      .then((r) => setData(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReset = async (id: string) => {
    setActing(id);
    try {
      await apiJson(`/v1/admin/offering-health/${encodeURIComponent(id)}/reset`, { method: "POST" });
      load();
    } catch { /* ignore */ }
    finally { setActing(null); }
  };

  const handleStop = async (id: string) => {
    if (!confirm(t("admin.nodeHealth.confirmStop"))) return;
    setActing(id);
    try {
      await apiJson(`/v1/admin/offering-health/${encodeURIComponent(id)}/stop`, { method: "POST" });
      load();
    } catch { /* ignore */ }
    finally { setActing(null); }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const unhealthy = data.filter(o => o.breakerState !== "closed" && o.enabled);
  const stopped = data.filter(o => !o.enabled);
  const healthy = data.filter(o => o.breakerState === "closed" && o.enabled);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.nodeHealth.title")}</h1>
        <FormButton variant="ghost" onClick={load} className="!px-3 !py-1.5 !text-xs">
          {t("admin.nodeHealth.refresh")}
        </FormButton>
      </div>

      {unhealthy.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-danger mb-3">{t("admin.nodeHealth.unhealthy")} ({unhealthy.length})</h2>
          <div className="space-y-2">
            {unhealthy.map((o) => <OfferingCard key={o.offeringId} o={o} acting={acting} onReset={handleReset} onStop={handleStop} t={t} />)}
          </div>
        </div>
      )}

      {stopped.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-tertiary mb-3">{t("admin.nodeHealth.stopped")} ({stopped.length})</h2>
          <div className="space-y-2">
            {stopped.map((o) => <OfferingCard key={o.offeringId} o={o} acting={acting} onReset={handleReset} onStop={handleStop} t={t} />)}
          </div>
        </div>
      )}

      <h2 className="text-sm font-semibold text-text-secondary mb-3">{t("admin.nodeHealth.healthy")} ({healthy.length})</h2>
      <div className="space-y-2">
        {healthy.map((o) => <OfferingCard key={o.offeringId} o={o} acting={acting} onReset={handleReset} onStop={handleStop} t={t} />)}
      </div>
    </div>
  );
}

function OfferingCard({ o, acting, onReset, onStop, t }: {
  o: OfferingHealth;
  acting: string | null;
  onReset: (id: string) => void;
  onStop: (id: string) => void;
  t: (k: string) => string;
}) {
  const badge = STATE_BADGE[o.breakerState] ?? STATE_BADGE.closed!;
  const isActing = acting === o.offeringId;

  return (
    <div className={`rounded-[var(--radius-card)] border bg-panel p-4 ${
      o.breakerState !== "closed" || !o.enabled ? "border-danger/30" : "border-line"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-medium">{o.logicalModel}</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {!o.enabled && <Badge variant="default">Stopped</Badge>}
            {o.autoDisabled && <Badge variant="danger">Auto-stopped</Badge>}
          </div>
          <div className="text-xs text-text-tertiary space-x-3">
            <span>{o.providerLabel || o.providerType}</span>
            <span>{o.realModel}</span>
            <span>{o.ownerName || o.ownerEmail || o.offeringId.slice(0, 12)}</span>
            {o.executionMode === "node" && <span>node</span>}
          </div>
          {o.breakerState !== "closed" && (
            <div className="mt-2 text-xs space-y-0.5">
              {o.errorClass && <div><span className="text-text-tertiary">Error class:</span> <span className="text-text-secondary">{o.errorClass}</span></div>}
              {o.failures > 0 && <div><span className="text-text-tertiary">Failures:</span> <span className="text-text-secondary">{o.failures}</span></div>}
              {o.cooldownMs > 0 && <div><span className="text-text-tertiary">Cooldown:</span> <span className="text-text-secondary">{formatCooldown(o.cooldownMs)}</span></div>}
              {o.lastFailureAt && <div><span className="text-text-tertiary">Last failure:</span> <span className="text-text-secondary">{new Date(o.lastFailureAt).toLocaleString()}</span></div>}
              {o.lastErrorMessage && <div className="text-danger/80 break-all mt-1">{o.lastErrorMessage.slice(0, 200)}</div>}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {(o.breakerState !== "closed") && (
            <FormButton variant="ghost" onClick={() => onReset(o.offeringId)} disabled={isActing} className="!px-2 !py-1 !text-xs">
              {t("admin.nodeHealth.reset")}
            </FormButton>
          )}
          {o.enabled && (
            <FormButton variant="ghost" onClick={() => onStop(o.offeringId)} disabled={isActing} className="!px-2 !py-1 !text-xs text-danger">
              {t("admin.nodeHealth.stop")}
            </FormButton>
          )}
        </div>
      </div>
    </div>
  );
}
