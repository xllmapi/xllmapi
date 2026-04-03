import { useState } from "react";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { formatNumber, formatTokens, formatProviderType } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { FormButton } from "@/components/ui/FormButton";
import { FormInput } from "@/components/ui/FormInput";
import { Badge } from "@/components/ui/Badge";

interface RequestRow {
  id: string;
  createdAt: string;
  userName: string;
  userEmail: string;
  logicalModel: string;
  provider: string;
  providerLabel?: string;
  realModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  status: string;
  chosenOfferingId: string;
  clientUserAgent?: string;
}

interface RequestDetail {
  id: string;
  createdAt: string;
  status: string;
  logicalModel: string;
  realModel: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  chosenOfferingId: string;
  clientIp: string | null;
  clientUserAgent: string | null;
  upstreamUserAgent: string | null;
  apiKeyId: string | null;
  userName: string | null;
  userEmail: string | null;
  requesterUserId: string;
  consumerCost: number | null;
  supplierReward: number | null;
  platformMargin: number | null;
  supplierRewardRate: number | null;
  settledAt: string | null;
  supplierUserId: string | null;
  supplierEmail: string | null;
  fixedPricePer1kInput: number | null;
  fixedPricePer1kOutput: number | null;
  cacheReadDiscount: number | null;
  providerLabel: string | null;
  responseBody: { fallbackAttempts?: Array<{ offeringId: string; error: string; errorClass: string }> } | null;
  clientFormat: string | null;
  upstreamFormat: string | null;
  formatConverted: boolean | null;
}

type TimeRange = 7 | 30 | 0;

/** Extract short client name from User-Agent */
function shortUA(ua?: string | null): string {
  if (!ua) return "-";
  // "claude-code/1.0.23" → "claude-code/1.0.23"
  // "Mozilla/5.0 ..." → "Browser"
  if (ua.startsWith("Mozilla/") || ua.includes("AppleWebKit")) return "Browser";
  // Take first token: "curl/8.0" → "curl/8.0"
  const first = ua.split(" ")[0];
  return first && first.length < 40 ? first : ua.slice(0, 30) + "...";
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

function RequestDetailPanel({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const { t } = useLocale();
  const { data: raw, loading } = useCachedFetch<{ data: RequestDetail }>(`/v1/admin/requests/${encodeURIComponent(requestId)}`);
  const detail = raw?.data ?? null;

  if (loading) return <div className="p-4 text-text-secondary text-xs">{t("common.loading")}</div>;
  if (!detail) return <div className="p-4 text-text-secondary text-xs">Not found</div>;

  const sections: Array<{ title: string; rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }> }> = [
    {
      title: t("admin.requests.detail.basic"),
      rows: [
        { label: t("admin.requests.detail.requestId"), value: detail.id, mono: true },
        { label: t("admin.requests.time"), value: new Date(detail.createdAt).toLocaleString() },
        { label: t("admin.requests.status"), value: <Badge variant={detail.status === "completed" ? "success" : "default"}>{detail.status}</Badge> },
      ],
    },
    {
      title: t("admin.requests.detail.requester"),
      rows: [
        { label: t("admin.requests.user"), value: `${detail.userName || "-"} (${detail.userEmail || "-"})` },
        { label: "IP", value: detail.clientIp },
      ],
    },
    {
      title: t("admin.requests.detail.source"),
      rows: [
        { label: t("admin.requests.detail.clientUA"), value: detail.clientUserAgent, mono: true },
        { label: t("admin.requests.detail.upstreamUA"), value: detail.upstreamUserAgent, mono: true },
        { label: "API Key ID", value: detail.apiKeyId, mono: true },
        { label: "Client Format", value: detail.clientFormat?.toUpperCase() },
        { label: "Upstream Format", value: detail.upstreamFormat?.toUpperCase() },
        { label: "Format Converted", value: detail.formatConverted ? "Yes" : detail.formatConverted === false ? "No" : "-" },
      ],
    },
    {
      title: t("admin.requests.model"),
      rows: [
        { label: t("admin.requests.detail.logicalModel"), value: detail.logicalModel, mono: true },
        { label: t("admin.requests.detail.realModel"), value: detail.realModel, mono: true },
        { label: t("admin.requests.provider"), value: formatProviderType(detail.provider, detail.providerLabel) },
      ],
    },
    {
      title: "Token",
      rows: [
        { label: t("admin.requests.inTokens"), value: `${formatTokens(detail.inputTokens)} tokens` },
        ...((detail.cacheReadTokens ?? 0) > 0 ? [{ label: "cache read", value: `${formatTokens(detail.cacheReadTokens ?? 0)} tokens` }] : []),
        ...((detail.cacheCreationTokens ?? 0) > 0 ? [{ label: "cache creation", value: `${formatTokens(detail.cacheCreationTokens ?? 0)} tokens` }] : []),
        { label: t("admin.requests.outTokens"), value: `${formatTokens(detail.outputTokens)} tokens` },
        { label: t("admin.requests.total"), value: `${formatTokens(detail.totalTokens)} tokens` },
      ],
    },
    {
      title: t("admin.requests.detail.settlement"),
      rows: detail.consumerCost != null ? (() => {
        const cr = detail.cacheReadTokens ?? 0;
        const prIn = detail.fixedPricePer1kInput ?? 0;
        const prOut = detail.fixedPricePer1kOutput ?? 0;
        const hasCacheSaving = cr > 0 && prIn > 0;
        const fullCost = hasCacheSaving
          ? Math.ceil(((detail.inputTokens + cr + (detail.cacheCreationTokens ?? 0)) * prIn) / 1000) + Math.ceil((detail.outputTokens * prOut) / 1000)
          : detail.consumerCost;
        const saved = fullCost - detail.consumerCost;
        return [
          ...(hasCacheSaving && saved > 0 ? [
            { label: "原价 (无折扣)", value: `${formatTokens(fullCost)} xt` },
            { label: "缓存命中节省", value: `-${formatTokens(saved)} xt (${Math.round((saved / fullCost) * 100)}%)` },
          ] : []),
          { label: t("admin.requests.detail.consumerCost"), value: `${formatTokens(detail.consumerCost)} xt` },
          { label: t("admin.requests.detail.supplierReward"), value: `${formatTokens(detail.supplierReward ?? 0)} xt` },
          { label: t("admin.requests.detail.platformMargin"), value: `${formatTokens(detail.platformMargin ?? 0)} xt` },
          { label: t("admin.requests.detail.rewardRate"), value: detail.supplierRewardRate != null ? `${(Number(detail.supplierRewardRate) * 100).toFixed(1)}%` : "-" },
          { label: t("admin.requests.detail.settledAt"), value: detail.settledAt ? new Date(detail.settledAt).toLocaleString() : "-" },
        ];
      })() : [{ label: t("admin.requests.detail.settlement"), value: "-" }],
    },
    {
      title: t("admin.requests.detail.supplier"),
      rows: [
        { label: t("admin.requests.detail.offeringId"), value: detail.chosenOfferingId, mono: true },
        { label: t("admin.requests.detail.supplierUser"), value: detail.supplierEmail || detail.supplierUserId || "-" },
        { label: t("admin.requests.detail.inputPrice"), value: detail.fixedPricePer1kInput != null ? `${detail.fixedPricePer1kInput} xt/1k tokens` : "-" },
        { label: t("admin.requests.detail.outputPrice"), value: detail.fixedPricePer1kOutput != null ? `${detail.fixedPricePer1kOutput} xt/1k tokens` : "-" },
        { label: "cache discount", value: detail.cacheReadDiscount != null ? `${detail.cacheReadDiscount}%` : "-" },
      ],
    },
    ...(detail.responseBody?.fallbackAttempts?.length ? [{
      title: "Fallback",
      rows: detail.responseBody.fallbackAttempts.map((a, i) => ({
        label: `#${i + 1} ${a.offeringId.slice(0, 16)}...`,
        value: <span className="text-danger text-xs">[{a.errorClass}] {a.error.slice(0, 120)}</span>,
      })),
    }] : []),
  ];

  return (
    <div className="border-t border-line bg-[rgba(16,21,34,0.4)] px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{t("admin.requests.detail.title")}</h3>
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
    </div>
  );
}

/* ---------- Main Page ---------- */

export function AdminRequestsPage() {
  const { t } = useLocale();
  const [days, setDays] = useState<TimeRange>(7);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [modelFilter, setModelFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (days > 0) params.set("days", String(days));
  if (modelFilter) params.set("model", modelFilter);
  if (providerFilter) params.set("provider", providerFilter);
  if (userFilter) params.set("user", userFilter);

  const { data: raw, loading } = useCachedFetch<{ data: RequestRow[]; total: number }>(`/v1/admin/requests?${params}`);
  const data = raw?.data ?? [];
  const total = raw?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const timeRanges: { key: TimeRange; label: string }[] = [
    { key: 7, label: "7d" },
    { key: 30, label: "30d" },
    { key: 0, label: t("admin.usage.allTime") },
  ];

  const columns: Column<RequestRow>[] = [
    {
      key: "createdAt",
      header: t("admin.requests.time"),
      render: (r) => {
        const d = new Date(r.createdAt);
        return (
          <span className="text-text-tertiary text-xs whitespace-nowrap" title={d.toLocaleString()}>
            {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            <span className="text-text-tertiary/50 ml-1">{d.toLocaleDateString([], { month: "numeric", day: "numeric" })}</span>
          </span>
        );
      },
    },
    {
      key: "userEmail",
      header: t("admin.requests.user"),
      render: (r) => (
        <span className="text-text-secondary text-xs truncate max-w-[100px] inline-block" title={r.userEmail}>
          {r.userName || r.userEmail}
        </span>
      ),
    },
    {
      key: "logicalModel",
      header: t("admin.requests.model"),
      render: (r) => (
        <span className="font-mono text-xs truncate max-w-[120px] inline-block" title={r.logicalModel}>
          {r.logicalModel}
        </span>
      ),
    },
    {
      key: "clientUserAgent" as keyof RequestRow,
      header: t("admin.requests.source"),
      render: (r) => (
        <span className="text-text-secondary text-xs font-mono" title={r.clientUserAgent || ""}>
          {shortUA(r.clientUserAgent)}
        </span>
      ),
    },
    {
      key: "totalTokens",
      header: "Tokens",
      align: "right",
      render: (r) => (
        <span className="text-xs whitespace-nowrap" title={`in: ${r.inputTokens} / out: ${r.outputTokens} / total: ${r.totalTokens}`}>
          <span className="font-medium">{formatTokens(r.totalTokens)}</span>
          <span className="text-text-tertiary/50 ml-1 text-[10px]">({formatTokens(r.inputTokens)}/{formatTokens(r.outputTokens)})</span>
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.requests.status"),
      render: (r) => (
        <Badge variant={r.status === "success" ? "success" : r.status === "error" ? "danger" : "default"}>
          {r.status ?? "ok"}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.requests.title")}</h1>
        <div className="flex gap-1">
          {timeRanges.map((r) => (
            <FormButton
              key={r.key}
              variant={days === r.key ? "primary" : "ghost"}
              onClick={() => { setDays(r.key); setPage(1); }}
              className="!px-3 !py-1.5 !text-xs"
            >
              {r.label}
            </FormButton>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <FormInput
          placeholder={t("admin.requests.filterModel")}
          value={modelFilter}
          onChange={(e) => { setModelFilter(e.target.value); setPage(1); }}
          className="!w-40"
        />
        <FormInput
          placeholder={t("admin.requests.filterProvider")}
          value={providerFilter}
          onChange={(e) => { setProviderFilter(e.target.value); setPage(1); }}
          className="!w-40"
        />
        <FormInput
          placeholder={t("admin.requests.filterUser")}
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
          className="!w-48"
        />
      </div>

      <div className="text-xs text-text-tertiary mb-2">
            {t("admin.requests.totalCount")}: {formatNumber(total)}
          </div>
          <DataTable
            columns={columns}
            data={data}
            rowKey={(r) => r.id}
            emptyText={t("common.empty")}
            loading={loading}
            onRowClick={(r) => setExpandedId(expandedId === r.id ? null : r.id)}
            activeRowKey={expandedId}
            renderExpanded={(r) =>
              expandedId === r.id ? (
                <RequestDetailPanel requestId={r.id} onClose={() => setExpandedId(null)} />
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
    </div>
  );
}
