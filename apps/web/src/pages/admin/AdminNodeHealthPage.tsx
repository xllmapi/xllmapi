import { useEffect, useState, useCallback, useMemo } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { Badge } from "@/components/ui/Badge";
import { FormButton } from "@/components/ui/FormButton";
import { FormInput } from "@/components/ui/FormInput";
import { DataTable, type Column } from "@/components/ui/DataTable";

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

type TabKey = "all" | "healthy" | "stopped" | "unhealthy";

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

/* ---------- Detail Panel ---------- */

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-text-tertiary text-xs w-32 shrink-0">{label}</span>
      <span className={`text-text-primary text-xs break-all ${mono ? "font-mono" : ""}`}>{value ?? "-"}</span>
    </div>
  );
}

function OfferingDetailPanel({
  offering,
  acting,
  onReset,
  onStop,
  onClose,
  t,
}: {
  offering: OfferingHealth;
  acting: string | null;
  onReset: (id: string) => void;
  onStop: (id: string) => void;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const o = offering;
  const badge = STATE_BADGE[o.breakerState] ?? STATE_BADGE.closed!;
  const isActing = acting === o.offeringId;

  const sections: Array<{ title: string; rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }> }> = [
    {
      title: t("admin.nodeHealth.detailBasic"),
      rows: [
        { label: "Offering ID", value: o.offeringId, mono: true },
        { label: t("admin.requests.model"), value: `${o.logicalModel} → ${o.realModel}`, mono: true },
        { label: t("admin.requests.provider"), value: o.providerLabel || o.providerType },
        { label: t("admin.nodeHealth.owner"), value: o.ownerName || o.ownerEmail || "-" },
        { label: t("admin.nodeHealth.execMode"), value: o.executionMode || "-" },
      ],
    },
    {
      title: t("admin.nodeHealth.breakerTitle"),
      rows: [
        { label: t("admin.nodeHealth.breakerState"), value: <Badge variant={badge.variant}>{badge.label}</Badge> },
        { label: t("admin.nodeHealth.errorClass"), value: o.errorClass || "-" },
        { label: t("admin.nodeHealth.failures"), value: String(o.failures) },
        { label: t("admin.nodeHealth.cooldown"), value: formatCooldown(o.cooldownMs) },
        { label: t("admin.nodeHealth.lastError"), value: o.lastErrorMessage ? o.lastErrorMessage.slice(0, 200) : "-" },
        { label: t("admin.nodeHealth.lastFailure"), value: o.lastFailureAt ? new Date(o.lastFailureAt).toLocaleString() : "-" },
        { label: t("admin.nodeHealth.autoDisabled"), value: o.autoDisabled ? "Yes" : "No" },
      ],
    },
    {
      title: t("admin.nodeHealth.configTitle"),
      rows: [
        { label: t("admin.nodeHealth.dailyLimit"), value: o.dailyTokenLimit != null ? `${o.dailyTokenLimit.toLocaleString()} tokens` : "-" },
        { label: t("admin.nodeHealth.maxConcurrency"), value: o.maxConcurrency != null ? String(o.maxConcurrency) : "-" },
      ],
    },
  ];

  return (
    <div className="border-t border-line bg-[rgba(16,21,34,0.4)] px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{t("admin.nodeHealth.detailTitle")}</h3>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xs cursor-pointer">
          {t("common.close")}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
        {sections.map((s) => (
          <div key={s.title} className="mb-3">
            <h4 className="text-xs font-medium text-accent mb-1">{s.title}</h4>
            {s.rows.map((r) => (
              <DetailRow key={r.label} label={r.label} value={r.value} mono={r.mono} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-line/50">
        {o.breakerState !== "closed" && (
          <FormButton variant="ghost" onClick={() => onReset(o.offeringId)} disabled={isActing} className="!px-3 !py-1.5 !text-xs">
            {t("admin.nodeHealth.reset")}
          </FormButton>
        )}
        {o.enabled && (
          <FormButton variant="ghost" onClick={() => onStop(o.offeringId)} disabled={isActing} className="!px-3 !py-1.5 !text-xs text-danger">
            {t("admin.nodeHealth.stop")}
          </FormButton>
        )}
      </div>
    </div>
  );
}

/* ---------- Main Page ---------- */

const PAGE_SIZE = 20;

export function AdminNodeHealthPage() {
  const { t } = useLocale();
  const [data, setData] = useState<OfferingHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Classify
  const counts = useMemo(() => {
    const all = data.length;
    const healthy = data.filter(o => o.enabled && o.breakerState === "closed").length;
    const stopped = data.filter(o => !o.enabled).length;
    const unhealthy = data.filter(o => o.enabled && o.breakerState !== "closed").length;
    return { all, healthy, stopped, unhealthy };
  }, [data]);

  // Filter by tab + search
  const filtered = useMemo(() => {
    let list = data;
    if (tab === "healthy") list = list.filter(o => o.enabled && o.breakerState === "closed");
    else if (tab === "stopped") list = list.filter(o => !o.enabled);
    else if (tab === "unhealthy") list = list.filter(o => o.enabled && o.breakerState !== "closed");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(o =>
        o.logicalModel.toLowerCase().includes(q) ||
        o.realModel.toLowerCase().includes(q) ||
        (o.providerLabel ?? "").toLowerCase().includes(q) ||
        o.providerType.toLowerCase().includes(q) ||
        (o.ownerName ?? "").toLowerCase().includes(q) ||
        (o.ownerEmail ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when tab/search changes
  useEffect(() => { setPage(1); setExpandedId(null); }, [tab, search]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: t("admin.nodeHealth.tabAll"), count: counts.all },
    { key: "healthy", label: t("admin.nodeHealth.tabHealthy"), count: counts.healthy },
    { key: "stopped", label: t("admin.nodeHealth.tabStopped"), count: counts.stopped },
    { key: "unhealthy", label: t("admin.nodeHealth.tabUnhealthy"), count: counts.unhealthy },
  ];

  const columns: Column<OfferingHealth>[] = [
    {
      key: "logicalModel",
      header: t("admin.requests.model"),
      render: (o) => (
        <span className="font-mono text-xs truncate max-w-[140px] inline-block" title={o.logicalModel}>
          {o.logicalModel}
        </span>
      ),
    },
    {
      key: "providerLabel",
      header: t("admin.requests.provider"),
      render: (o) => (
        <span className="text-text-secondary text-xs truncate max-w-[100px] inline-block">
          {o.providerLabel || o.providerType}
        </span>
      ),
    },
    {
      key: "ownerName",
      header: t("admin.nodeHealth.owner"),
      render: (o) => (
        <span className="text-text-secondary text-xs truncate max-w-[100px] inline-block">
          {o.ownerName || o.ownerEmail || "-"}
        </span>
      ),
    },
    {
      key: "breakerState",
      header: t("admin.nodeHealth.breakerState"),
      render: (o) => {
        const badge = STATE_BADGE[o.breakerState] ?? STATE_BADGE.closed!;
        return (
          <span className="flex items-center gap-1">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {!o.enabled && <Badge variant="default">Stopped</Badge>}
            {o.autoDisabled && <Badge variant="danger">Auto</Badge>}
          </span>
        );
      },
    },
    {
      key: "failures",
      header: t("admin.nodeHealth.failures"),
      align: "right",
      render: (o) => (
        <span className="text-xs">{o.failures > 0 ? o.failures : "-"}</span>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.nodeHealth.title")}</h1>
        <FormButton variant="ghost" onClick={load} className="!px-3 !py-1.5 !text-xs">
          {t("admin.nodeHealth.refresh")}
        </FormButton>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4">
        {tabs.map((tb) => (
          <FormButton
            key={tb.key}
            variant={tab === tb.key ? "primary" : "ghost"}
            onClick={() => setTab(tb.key)}
            className="!px-3 !py-1.5 !text-xs"
          >
            {tb.label}
            <span className="ml-1 text-[10px] opacity-70">({tb.count})</span>
          </FormButton>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <FormInput
          placeholder={t("admin.nodeHealth.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="!w-64"
        />
      </div>

      {loading ? (
        <p className="text-text-secondary py-8">{t("common.loading")}</p>
      ) : (
        <>
          <div className="text-xs text-text-tertiary mb-2">
            {filtered.length} {t("admin.nodeHealth.items")}
          </div>
          <DataTable
            columns={columns}
            data={paginated}
            rowKey={(o) => o.offeringId}
            emptyText={t("common.empty")}
            onRowClick={(o) => setExpandedId(expandedId === o.offeringId ? null : o.offeringId)}
            activeRowKey={expandedId}
            renderExpanded={(o) =>
              expandedId === o.offeringId ? (
                <OfferingDetailPanel
                  offering={o}
                  acting={acting}
                  onReset={handleReset}
                  onStop={handleStop}
                  onClose={() => setExpandedId(null)}
                  t={t}
                />
              ) : null
            }
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <FormButton
                variant="ghost"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="!px-3 !py-1.5 !text-xs"
              >
                &larr;
              </FormButton>
              <span className="text-sm text-text-secondary">
                {page} / {totalPages}
              </span>
              <FormButton
                variant="ghost"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="!px-3 !py-1.5 !text-xs"
              >
                &rarr;
              </FormButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}
