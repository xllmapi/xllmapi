import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";

interface AdminStats {
  userCount: number;
  invitationCount: number;
  pendingCount: number;
  totalTokens: number;
}

export function AdminOverviewPage() {
  const { t } = useLocale();
  const [stats, setStats] = useState<AdminStats>({
    userCount: 0,
    invitationCount: 0,
    pendingCount: 0,
    totalTokens: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiJson<{ data: unknown[] }>("/v1/admin/users"),
      apiJson<{ data: unknown[] }>("/v1/admin/invitations"),
      apiJson<{ data: unknown[] }>("/v1/admin/offerings/pending"),
      apiJson<{ data: { summary: { totalTokens: number; totalRequests: number } } }>("/v1/admin/usage"),
    ])
      .then(([users, invitations, pending, usage]) => {
        setStats({
          userCount: users.data?.length ?? 0,
          invitationCount: invitations.data?.length ?? 0,
          pendingCount: pending.data?.length ?? 0,
          totalTokens: usage.data?.summary?.totalTokens ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.overview.title")}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t("admin.overview.users")} value={formatNumber(stats.userCount)} />
        <StatCard label={t("admin.overview.invitations")} value={formatNumber(stats.invitationCount)} />
        <StatCard label={t("admin.overview.pending")} value={formatNumber(stats.pendingCount)} />
        <StatCard label={t("admin.overview.tokens")} value={formatNumber(stats.totalTokens)} />
      </div>
    </div>
  );
}
