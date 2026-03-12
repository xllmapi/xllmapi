import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface UsageData {
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  topModels?: TopModel[];
}

interface TopModel {
  model: string;
  tokens: number;
  requests: number;
}

export function UsagePage() {
  const { t } = useLocale();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ data: UsageData }>("/v1/admin/usage")
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const columns: Column<TopModel>[] = [
    { key: "model", header: t("admin.usage.model"), className: "font-mono text-xs" },
    {
      key: "tokens",
      header: t("admin.usage.tokens"),
      align: "right",
      render: (m) => formatNumber(m.tokens),
    },
    {
      key: "requests",
      header: t("admin.usage.requests"),
      align: "right",
      render: (m) => formatNumber(m.requests),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.usage.title")}</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard label={t("admin.usage.totalTokens")} value={formatNumber(data?.totalTokens ?? 0)} />
        <StatCard label={t("admin.usage.totalRequests")} value={formatNumber(data?.totalRequests ?? 0)} />
        <StatCard label={t("admin.usage.totalCost")} value={`$${(data?.totalCost ?? 0).toFixed(4)}`} />
      </div>

      {data?.topModels && data.topModels.length > 0 && (
        <>
          <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.usage.topModels")}</h2>
          <DataTable
            columns={columns}
            data={data.topModels}
            rowKey={(m) => m.model}
          />
        </>
      )}
    </div>
  );
}
