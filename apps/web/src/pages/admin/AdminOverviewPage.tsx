import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { formatNumber, formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { FormButton } from "@/components/ui/FormButton";

interface RecentRequest {
  requestId: string;
  logicalModel: string;
  provider: string;
  totalTokens: number;
  createdAt: string;
  userName: string;
  userEmail: string;
}

interface ProviderInfo {
  providerType: string;
  offeringCount: number;
  requestCount: number;
}

interface AdminStats {
  activeUsers: number;
  openSettlementFailures: number;
}

interface SettlementFailurePreview {
  id: string;
  requestId: string;
  logicalModel: string;
  requesterEmail: string;
  errorMessage: string;
  lastFailedAt: string;
}
export function AdminOverviewPage() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [openSettlementFailures, setOpenSettlementFailures] = useState(0);
  const [settlementFailures, setSettlementFailures] = useState<SettlementFailurePreview[]>([]);
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    Promise.all([
      apiJson<{ data: unknown[] }>("/v1/admin/users"),
      apiJson<{ data: AdminStats }>("/v1/admin/stats"),
      apiJson<{ data: { summary: { totalRequests: number; offeringCount: number } } }>("/v1/admin/usage"),
      apiJson<{ data: unknown[] }>("/v1/admin/offerings/pending"),
      apiJson<{ data: RecentRequest[] }>("/v1/admin/usage/recent?limit=15"),
      apiJson<{ data: ProviderInfo[] }>("/v1/admin/providers"),
      apiJson<{ data: SettlementFailurePreview[] }>("/v1/admin/settlement-failures?status=open&limit=5"),
    ])
      .then(([users, stats, usage, pending, recent, provs, failures]) => {
        setUserCount(users.data?.length ?? 0);
        setActiveUsers(stats.data?.activeUsers ?? 0);
        setOpenSettlementFailures(stats.data?.openSettlementFailures ?? 0);
        setTotalRequests(usage.data?.summary?.totalRequests ?? 0);
        setModelCount(usage.data?.summary?.offeringCount ?? 0);
        setPendingCount(pending.data?.length ?? 0);
        setRecentRequests(recent.data ?? []);
        setProviders(provs.data ?? []);
        setSettlementFailures(failures.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const recentColumns: Column<RecentRequest>[] = [
    {
      key: "logicalModel",
      header: t("admin.usage.model"),
      className: "font-mono text-xs",
    },
    {
      key: "provider",
      header: t("admin.overview.provider"),
      render: (r) => <span className="text-text-secondary text-xs">{r.provider}</span>,
    },
    {
      key: "totalTokens",
      header: t("admin.usage.tokens"),
      align: "right",
      render: (r) => <span className="text-text-secondary">{formatTokens(r.totalTokens)}</span>,
    },
    {
      key: "userEmail",
      header: t("admin.users.email"),
      render: (r) => <span className="text-text-secondary text-xs">{r.userName || r.userEmail}</span>,
    },
    {
      key: "createdAt",
      header: t("admin.overview.time"),
      render: (r) => (
        <span className="text-text-tertiary text-xs">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.overview.title")}</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label={t("admin.overview.users")} value={formatNumber(userCount)} />
        <StatCard label={t("admin.overview.active7d")} value={formatNumber(activeUsers)} />
        <StatCard label={t("admin.usage.totalRequests")} value={formatNumber(totalRequests)} />
        <StatCard label={t("admin.overview.models")} value={formatNumber(modelCount)} />
        <StatCard label={t("admin.overview.pending")} value={formatNumber(pendingCount)} />
        <Link to="/admin/settlement-failures" className="no-underline">
          <div className="rounded-[var(--radius-card)] border border-danger/30 bg-danger/5 p-5 hover:bg-danger/10 transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-danger/80 text-xs mb-2">{t("admin.overview.openSettlementFailures")}</p>
                <p className="text-xl font-heading font-bold tracking-tight text-danger">{formatNumber(openSettlementFailures)}</p>
              </div>
              <Badge variant={openSettlementFailures > 0 ? "danger" : "success"}>
                {openSettlementFailures > 0 ? t("admin.settlementFailures.open") : t("admin.settlementFailures.resolved")}
              </Badge>
            </div>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Requests */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.overview.recentRequests")}</h2>
          <DataTable
            columns={recentColumns}
            data={recentRequests}
            rowKey={(r) => r.requestId}
            emptyText={t("common.empty")}
          />
        </div>

        {/* Provider Health */}
        <div>
          <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.overview.providerHealth")}</h2>
          <div className="space-y-3">
            {providers.length === 0 ? (
              <p className="text-text-tertiary text-sm">{t("common.empty")}</p>
            ) : (
              providers.map((p) => (
                <div
                  key={p.providerType}
                  className="rounded-[var(--radius-card)] border border-line bg-panel p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{p.providerType}</span>
                    <Badge variant={p.requestCount > 0 ? "success" : "default"}>
                      {p.requestCount > 0 ? "active" : "idle"}
                    </Badge>
                  </div>
                  <div className="flex gap-4 text-xs text-text-secondary">
                    <span>{p.offeringCount} {t("admin.overview.offerings")}</span>
                    <span>{formatNumber(p.requestCount)} {t("admin.usage.requests")}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t("admin.overview.recentSettlementFailures")}</h2>
          <Link to="/admin/settlement-failures" className="no-underline">
            <FormButton
              variant="ghost"
              className="!px-3 !py-1.5 !text-xs"
            >
              {t("admin.overview.viewAllFailures")}
            </FormButton>
          </Link>
        </div>
        {settlementFailures.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-panel px-6 py-8 text-sm text-text-tertiary">
            {t("admin.overview.noOpenSettlementFailures")}
          </div>
        ) : (
          <div className="space-y-3">
            {settlementFailures.map((failure) => (
              <Link
                key={failure.id}
                to="/admin/settlement-failures"
                className="block rounded-[var(--radius-card)] border border-danger/20 bg-panel px-4 py-4 no-underline hover:bg-danger/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs text-text-primary">{failure.logicalModel}</span>
                      <Badge variant="danger">{t("admin.settlementFailures.open")}</Badge>
                    </div>
                    <p className="text-xs text-text-secondary truncate">{failure.requesterEmail}</p>
                    <p className="text-sm text-text-primary truncate mt-1">{failure.errorMessage}</p>
                  </div>
                  <span className="shrink-0 text-xs text-text-tertiary">
                    {new Date(failure.lastFailedAt).toLocaleString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
