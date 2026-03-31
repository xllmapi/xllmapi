import { useEffect, useState, useCallback, useMemo } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { Badge } from "@/components/ui/Badge";
import { FormButton } from "@/components/ui/FormButton";
import { FormInput } from "@/components/ui/FormInput";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatTokens } from "@/lib/utils";

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
  // Node status
  nodeStatus: string; // 'orphaned' | 'banned' | 'admin_stopped' | 'auto_stopped' | 'stopped' | 'active'
  disabledBy: string | null;
}

interface OfferingStats {
  avgLatency: { total: number; ttfb: number; queue: number; upstream: number };
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  successRate: number;
  todayRequests: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todaySuccessRate: number;
  recentRequests: Array<{
    id: string;
    status: string;
    totalMs: number | null;
    ttfbMs: number | null;
    tokens: number;
    createdAt: string;
  }>;
}

type TabKey = "all" | "healthy" | "stopped" | "banned" | "orphaned" | "unhealthy";

const NODE_STATUS_BADGE: Record<string, { variant: "success" | "danger" | "warning" | "default"; label: string; labelEn: string }> = {
  active: { variant: "success", label: "正常", labelEn: "Healthy" },
  stopped: { variant: "default", label: "已停止", labelEn: "Stopped" },
  admin_stopped: { variant: "default", label: "管理员停止", labelEn: "Admin Stopped" },
  banned: { variant: "danger", label: "已禁用", labelEn: "Banned" },
  auto_stopped: { variant: "warning", label: "自动停止", labelEn: "Auto Stopped" },
  orphaned: { variant: "danger", label: "已失效", labelEn: "Orphaned" },
  unhealthy: { variant: "warning", label: "异常", labelEn: "Unhealthy" },
};

function getDisplayStatus(o: OfferingHealth): string {
  return o.nodeStatus === "active" && o.breakerState !== "closed" ? "unhealthy" : o.nodeStatus;
}

function formatCooldown(ms: number): string {
  if (ms <= 0) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/* ---------- Stats Panel ---------- */

function StatsPanel({ offeringId, t }: { offeringId: string; t: (k: string) => string }) {
  const [stats, setStats] = useState<OfferingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ data: { total: Record<string, string>; today: Record<string, string>; avgLatency: Record<string, string>; recentRequests: Array<{ id: string; status: string; totalMs: number | null; ttfbMs: number | null; tokens: number; createdAt: string }> } }>(`/v1/admin/offering-health/${encodeURIComponent(offeringId)}/stats`)
      .then((res) => {
        const d = res.data;
        setStats({
          avgLatency: { total: Number(d.avgLatency?.total ?? 0), ttfb: Number(d.avgLatency?.ttfb ?? 0), queue: Number(d.avgLatency?.queue ?? 0), upstream: Number(d.avgLatency?.upstream ?? 0) },
          totalRequests: Number(d.total?.totalRequests ?? 0),
          totalInputTokens: Number(d.total?.totalInputTokens ?? 0),
          totalOutputTokens: Number(d.total?.totalOutputTokens ?? 0),
          successRate: Number(d.total?.successRate ?? 0),
          todayRequests: Number(d.today?.todayRequests ?? 0),
          todayInputTokens: Number(d.today?.todayInputTokens ?? 0),
          todayOutputTokens: Number(d.today?.todayOutputTokens ?? 0),
          todaySuccessRate: Number(d.today?.todaySuccessRate ?? 0),
          recentRequests: d.recentRequests ?? [],
        });
      })
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [offeringId]);

  if (loading) return <p className="text-text-secondary text-xs py-2">{t("common.loading")}</p>;
  if (!stats) return <p className="text-text-tertiary text-xs py-2">No stats available</p>;

  const { avgLatency } = stats;
  const total = avgLatency.total || 1;
  const queuePct = Math.max(2, (avgLatency.queue / total) * 100);
  const ttfbPct = Math.max(2, (avgLatency.ttfb / total) * 100);
  const upstreamPct = Math.max(2, (avgLatency.upstream / total) * 100);

  return (
    <div className="mt-3 pt-3 border-t border-line/50">
      <h4 className="text-xs font-medium text-accent mb-2">{t("admin.nodeHealth.statsTitle")}</h4>

      {/* Latency bar */}
      <div className="mb-3">
        <p className="text-[10px] text-text-tertiary mb-1">{t("admin.nodeHealth.latencyTitle")}</p>
        {avgLatency.total > 0 ? (
          <>
            <div className="flex h-6 rounded overflow-hidden text-[10px] font-mono">
              <div style={{ width: `${queuePct}%` }} className="bg-blue-500/60 flex items-center justify-center text-white">
                {Math.round(avgLatency.queue)}ms
              </div>
              <div style={{ width: `${ttfbPct}%` }} className="bg-amber-500/60 flex items-center justify-center text-white">
                {Math.round(avgLatency.ttfb)}ms
              </div>
              <div style={{ width: `${upstreamPct}%` }} className="bg-emerald-500/60 flex items-center justify-center text-white">
                {Math.round(avgLatency.upstream)}ms
              </div>
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-text-tertiary">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500/60 inline-block" />{t("admin.nodeHealth.latencyQueue")}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500/60 inline-block" />{t("admin.nodeHealth.latencyTtfb")}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/60 inline-block" />{t("admin.nodeHealth.latencyUpstream")}</span>
              <span>{t("admin.nodeHealth.latencyTotal")}: {Math.round(avgLatency.total)}ms</span>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-text-tertiary">-</p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <p className="text-[10px] text-text-tertiary">{t("admin.nodeHealth.totalRequests")}</p>
          <p className="text-sm font-mono">{stats.totalRequests.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary">{t("admin.nodeHealth.successRate")}</p>
          <p className="text-sm font-mono">{(stats.successRate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary">{t("admin.nodeHealth.totalTokens")}</p>
          <p className="text-sm font-mono">{formatTokens(stats.totalInputTokens + stats.totalOutputTokens)}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary">{t("admin.nodeHealth.todayRequests")}</p>
          <p className="text-sm font-mono">{stats.todayRequests.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary">{t("admin.nodeHealth.todayTokens")}</p>
          <p className="text-sm font-mono">{formatTokens(stats.todayInputTokens + stats.todayOutputTokens)}</p>
        </div>
        {stats.todayRequests > 0 && (
          <div>
            <p className="text-[10px] text-text-tertiary">{t("admin.nodeHealth.successRate")} (today)</p>
            <p className="text-sm font-mono">{(stats.todaySuccessRate * 100).toFixed(1)}%</p>
          </div>
        )}
      </div>

      {/* Recent requests */}
      {stats.recentRequests.length > 0 && (
        <div>
          <p className="text-[10px] text-text-tertiary mb-1">{t("admin.nodeHealth.recentTitle")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-text-tertiary border-b border-line/30">
                  <th className="text-left py-1 pr-3 font-normal">ID</th>
                  <th className="text-left py-1 pr-3 font-normal">Status</th>
                  <th className="text-right py-1 pr-3 font-normal">Total</th>
                  <th className="text-right py-1 pr-3 font-normal">TTFB</th>
                  <th className="text-right py-1 pr-3 font-normal">Tokens</th>
                  <th className="text-left py-1 font-normal">Time</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRequests.map((r) => (
                  <tr key={r.id} className="border-b border-line/10">
                    <td className="py-1 pr-3 truncate max-w-[80px]" title={r.id}>{r.id.slice(-8)}</td>
                    <td className="py-1 pr-3">
                      <Badge variant={r.status === "success" ? "success" : "danger"}>{r.status}</Badge>
                    </td>
                    <td className="text-right py-1 pr-3">{r.totalMs}ms</td>
                    <td className="text-right py-1 pr-3">{r.ttfbMs}ms</td>
                    <td className="text-right py-1 pr-3">{r.tokens}</td>
                    <td className="py-1">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
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
  onBan,
  onUnban,
  onStart,
  onDelete,
  onClose,
  t,
}: {
  offering: OfferingHealth;
  acting: string | null;
  onReset: (id: string) => void;
  onStop: (id: string) => void;
  onBan: (id: string) => void;
  onUnban: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const o = offering;
  const displayStatus = getDisplayStatus(o);
  const badge = NODE_STATUS_BADGE[displayStatus] ?? NODE_STATUS_BADGE.active!;
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
        { label: t("admin.nodeHealth.nodeStatus"), value: <Badge variant={badge.variant}>{badge.label}</Badge> },
      ],
    },
    {
      title: t("admin.nodeHealth.breakerTitle"),
      rows: [
        { label: t("admin.nodeHealth.breakerState"), value: o.breakerState },
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

  // Determine available actions based on displayStatus
  const actions: Array<{ label: string; onClick: () => void; variant: "ghost" | "primary"; danger?: boolean }> = [];

  if (displayStatus === "active") {
    // healthy
    actions.push({ label: t("admin.nodeHealth.stop"), onClick: () => onStop(o.offeringId), variant: "ghost", danger: true });
    actions.push({ label: t("admin.nodeHealth.ban"), onClick: () => onBan(o.offeringId), variant: "ghost", danger: true });
  } else if (displayStatus === "unhealthy") {
    actions.push({ label: t("admin.nodeHealth.stop"), onClick: () => onStop(o.offeringId), variant: "ghost", danger: true });
    actions.push({ label: t("admin.nodeHealth.ban"), onClick: () => onBan(o.offeringId), variant: "ghost", danger: true });
    actions.push({ label: t("admin.nodeHealth.reset"), onClick: () => onReset(o.offeringId), variant: "ghost" });
  } else if (displayStatus === "stopped" || displayStatus === "admin_stopped") {
    actions.push({ label: t("admin.nodeHealth.start"), onClick: () => onStart(o.offeringId), variant: "ghost" });
    actions.push({ label: t("admin.nodeHealth.ban"), onClick: () => onBan(o.offeringId), variant: "ghost", danger: true });
  } else if (displayStatus === "banned") {
    actions.push({ label: t("admin.nodeHealth.unban"), onClick: () => onUnban(o.offeringId), variant: "ghost" });
  } else if (displayStatus === "auto_stopped") {
    actions.push({ label: t("admin.nodeHealth.reset"), onClick: () => onReset(o.offeringId), variant: "ghost" });
    actions.push({ label: t("admin.nodeHealth.ban"), onClick: () => onBan(o.offeringId), variant: "ghost", danger: true });
  } else if (displayStatus === "orphaned") {
    actions.push({ label: t("admin.nodeHealth.delete"), onClick: () => onDelete(o.offeringId), variant: "ghost", danger: true });
  }

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
      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-line/50">
          {actions.map((a) => (
            <FormButton
              key={a.label}
              variant={a.variant}
              onClick={a.onClick}
              disabled={isActing}
              className={`!px-3 !py-1.5 !text-xs ${a.danger ? "text-danger" : ""}`}
            >
              {a.label}
            </FormButton>
          ))}
        </div>
      )}
      {/* Stats panel */}
      <StatsPanel offeringId={o.offeringId} t={t} />
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

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant: "warning" | "danger";
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", variant: "warning", onConfirm: () => {} });

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

  const handleBan = (id: string) => {
    setConfirmState({
      open: true,
      title: t("admin.nodeHealth.ban"),
      description: t("admin.nodeHealth.confirmBan"),
      variant: "danger",
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        setActing(id);
        try {
          await apiJson(`/v1/admin/offering-health/${encodeURIComponent(id)}/ban`, { method: "POST" });
          load();
        } catch { /* ignore */ }
        finally { setActing(null); }
      },
    });
  };

  const handleUnban = async (id: string) => {
    setActing(id);
    try {
      await apiJson(`/v1/admin/offering-health/${encodeURIComponent(id)}/unban`, { method: "POST" });
      load();
    } catch { /* ignore */ }
    finally { setActing(null); }
  };

  const handleStart = async (id: string) => {
    setActing(id);
    try {
      await apiJson(`/v1/admin/offering-health/${encodeURIComponent(id)}/start`, { method: "POST" });
      load();
    } catch { /* ignore */ }
    finally { setActing(null); }
  };

  const handleDelete = (id: string) => {
    setConfirmState({
      open: true,
      title: t("admin.nodeHealth.delete"),
      description: t("admin.nodeHealth.confirmDelete"),
      variant: "danger",
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        setActing(id);
        try {
          await apiJson(`/v1/admin/offering-health/${encodeURIComponent(id)}`, { method: "DELETE" });
          load();
        } catch { /* ignore */ }
        finally { setActing(null); }
      },
    });
  };

  // Classify using displayStatus
  const counts = useMemo(() => {
    const all = data.length;
    const healthy = data.filter((o) => getDisplayStatus(o) === "active").length;
    const stopped = data.filter((o) => {
      const s = getDisplayStatus(o);
      return s === "stopped" || s === "admin_stopped" || s === "auto_stopped";
    }).length;
    const banned = data.filter((o) => getDisplayStatus(o) === "banned").length;
    const orphaned = data.filter((o) => getDisplayStatus(o) === "orphaned").length;
    const unhealthy = data.filter((o) => getDisplayStatus(o) === "unhealthy").length;
    return { all, healthy, stopped, banned, orphaned, unhealthy };
  }, [data]);

  // Filter by tab + search
  const filtered = useMemo(() => {
    let list = data;
    if (tab === "healthy") list = list.filter((o) => getDisplayStatus(o) === "active");
    else if (tab === "stopped") {
      list = list.filter((o) => {
        const s = getDisplayStatus(o);
        return s === "stopped" || s === "admin_stopped" || s === "auto_stopped";
      });
    } else if (tab === "banned") list = list.filter((o) => getDisplayStatus(o) === "banned");
    else if (tab === "orphaned") list = list.filter((o) => getDisplayStatus(o) === "orphaned");
    else if (tab === "unhealthy") list = list.filter((o) => getDisplayStatus(o) === "unhealthy");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((o) =>
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
    { key: "banned", label: t("admin.nodeHealth.tabBanned"), count: counts.banned },
    { key: "orphaned", label: t("admin.nodeHealth.tabOrphaned"), count: counts.orphaned },
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
      key: "nodeStatus",
      header: t("admin.nodeHealth.nodeStatus"),
      render: (o) => {
        const displayStatus = getDisplayStatus(o);
        const badge = NODE_STATUS_BADGE[displayStatus] ?? NODE_STATUS_BADGE.active!;
        return <Badge variant={badge.variant}>{badge.label}</Badge>;
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
      <div className="flex gap-1 mb-4 flex-wrap">
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
                  onBan={handleBan}
                  onUnban={handleUnban}
                  onStart={handleStart}
                  onDelete={handleDelete}
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

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmState.open}
        onClose={() => setConfirmState((s) => ({ ...s, open: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
      />
    </div>
  );
}
