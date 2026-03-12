import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";
import { ContributionGraph } from "@/components/ui/ContributionGraph";
import { DataTable, type Column } from "@/components/ui/DataTable";


interface OverviewData {
  me: { displayName: string; email: string } | null;
  wallet: number;
  supplyUsage: { totalTokens: number; totalRequests: number } | null;
  consumptionUsage: { totalTokens: number; totalRequests: number; totalCost?: number; byModel?: UsageRecord[] } | null;
  offeringCount: number;
}

interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  totalCost: number;
}

export function OverviewPage() {
  const { t } = useLocale();
  const [data, setData] = useState<OverviewData>({
    me: null,
    wallet: 0,
    supplyUsage: null,
    consumptionUsage: null,
    offeringCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [heatmapData] = useState<Record<string, number>>(() => {
    // Generate sample data for now - will be replaced by API
    const d: Record<string, number> = {};
    const today = new Date();
    for (let i = 0; i < 140; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      d[key] = Math.random() > 0.6 ? Math.floor(Math.random() * 10000) : 0;
    }
    return d;
  });

  useEffect(() => {
    Promise.all([
      apiJson<{ data: { displayName: string; email: string } }>("/v1/me"),
      apiJson<{ data: { balance: number } }>("/v1/wallet"),
      apiJson<{ data: { totalTokens: number; totalRequests: number } }>("/v1/usage/supply"),
      apiJson<{ data: { totalTokens: number; totalRequests: number; totalCost?: number; byModel?: UsageRecord[] } }>("/v1/usage/consumption"),
      apiJson<{ data: unknown[] }>("/v1/offerings"),
    ])
      .then(([me, wallet, supply, consumption, offerings]) => {
        setData({
          me: me.data,
          wallet: wallet.data?.balance ?? 0,
          supplyUsage: supply.data,
          consumptionUsage: consumption.data,
          offeringCount: offerings.data?.length ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-text-secondary py-8">{t("common.loading")}</p>;
  }

  const detailColumns: Column<UsageRecord>[] = [
    {
      key: "model",
      header: t("overview.model"),
      className: "font-mono text-xs",
    },
    {
      key: "totalTokens",
      header: t("overview.tokens"),
      align: "right",
      render: (r) => formatNumber(r.totalTokens),
    },
    {
      key: "requestCount",
      header: "Requests",
      align: "right",
      render: (r) => formatNumber(r.requestCount),
    },
    {
      key: "totalCost",
      header: t("overview.amount"),
      align: "right",
      render: (r) => `$${r.totalCost.toFixed(4)}`,
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">
        {t("overview.welcome")}{data.me?.displayName ? `, ${data.me.displayName}` : ""}
      </h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={t("overview.balance")}
          value={`${formatNumber(Math.round(data.wallet * 10000))} ${t("overview.unit")}`}
        />
        <StatCard
          label={t("overview.supply")}
          value={formatNumber(data.supplyUsage?.totalTokens ?? 0)}
        />
        <StatCard
          label={t("overview.consumed")}
          value={formatNumber(data.consumptionUsage?.totalTokens ?? 0)}
        />
        <StatCard
          label={t("overview.offerings")}
          value={String(data.offeringCount)}
        />
      </div>

      {/* Contribution heatmap */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-8">
        <h2 className="text-sm font-semibold mb-4 text-text-secondary">{t("overview.usage")}</h2>
        <ContributionGraph data={heatmapData} weeks={20} />
      </div>

      {/* Detail table */}
      <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("overview.details")}</h2>
      <DataTable
        columns={detailColumns}
        data={data.consumptionUsage?.byModel ?? []}
        rowKey={(r) => r.model}
        emptyText={t("overview.noRecords")}
      />
    </div>
  );
}
