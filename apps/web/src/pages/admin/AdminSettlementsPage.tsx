import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { FormButton } from "@/components/ui/FormButton";

interface SettlementRow {
  id: string;
  requestId: string;
  consumerName: string;
  consumerEmail: string;
  supplierName: string;
  supplierEmail: string;
  consumerCost: number;
  supplierReward: number;
  platformMargin: number;
  supplierRewardRate: number | null;
  createdAt: string;
}

interface Summary {
  totalConsumerCost: number;
  totalSupplierReward: number;
  totalPlatformMargin: number;
  count: number;
}

type TimeRange = 7 | 30 | 0;

export function AdminSettlementsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<SettlementRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalConsumerCost: 0, totalSupplierReward: 0, totalPlatformMargin: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<TimeRange>(7);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (days > 0) params.set("days", String(days));

    apiJson<{ data: SettlementRow[]; summary: Summary }>(`/v1/admin/settlements?${params}`)
      .then((r) => {
        setData(r.data ?? []);
        setSummary(r.summary ?? { totalConsumerCost: 0, totalSupplierReward: 0, totalPlatformMargin: 0, count: 0 });
        setTotal(r.summary?.count ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, limit, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const timeRanges: { key: TimeRange; label: string }[] = [
    { key: 7, label: "7d" },
    { key: 30, label: "30d" },
    { key: 0, label: t("admin.usage.allTime") },
  ];

  const columns: Column<SettlementRow>[] = [
    {
      key: "createdAt",
      header: t("admin.settlements.time"),
      render: (r) => (
        <span className="text-text-tertiary text-xs whitespace-nowrap">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "consumerEmail",
      header: t("admin.settlements.consumer"),
      render: (r) => <span className="text-text-secondary text-xs">{r.consumerName || r.consumerEmail}</span>,
    },
    {
      key: "supplierEmail",
      header: t("admin.settlements.supplier"),
      render: (r) => <span className="text-text-secondary text-xs">{r.supplierName || r.supplierEmail}</span>,
    },
    {
      key: "supplierRewardRate",
      header: t("admin.settlements.rewardRate"),
      align: "right",
      render: (r) => (
        <span className="text-xs text-text-secondary">
          {r.supplierRewardRate != null ? `${Math.round(r.supplierRewardRate * 100)}%` : "\u2014"}
        </span>
      ),
    },
    {
      key: "consumerCost",
      header: t("admin.settlements.cost"),
      align: "right",
      render: (r) => <span className="text-xs">{formatNumber(r.consumerCost)}</span>,
    },
    {
      key: "supplierReward",
      header: t("admin.settlements.reward"),
      align: "right",
      render: (r) => <span className="text-xs">{formatNumber(r.supplierReward)}</span>,
    },
    {
      key: "platformMargin",
      header: t("admin.settlements.margin"),
      align: "right",
      render: (r) => <span className="text-xs font-medium">{formatNumber(r.platformMargin)}</span>,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.settlements.title")}</h1>
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

      {loading ? (
        <p className="text-text-secondary py-8">{t("common.loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label={t("admin.settlements.totalRevenue")} value={formatNumber(summary.totalConsumerCost)} />
            <StatCard label={t("admin.settlements.supplierPayout")} value={formatNumber(summary.totalSupplierReward)} />
            <StatCard label={t("admin.settlements.platformProfit")} value={formatNumber(summary.totalPlatformMargin)} />
            <StatCard label={t("admin.settlements.count")} value={formatNumber(summary.count)} />
          </div>

          <DataTable
            columns={columns}
            data={data}
            rowKey={(r) => r.id}
            emptyText={t("common.empty")}
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
