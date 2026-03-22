import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface ProviderInfo {
  providerType: string;
  offeringCount: number;
  requestCount: number;
}

export function ProvidersPage() {
  const { t } = useLocale();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ data: ProviderInfo[] }>("/v1/admin/providers")
      .then((r) => setProviders(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const columns: Column<ProviderInfo>[] = [
    {
      key: "providerType",
      header: t("admin.providers.type"),
      render: (p) => <span className="font-medium">{p.providerType}</span>,
    },
    {
      key: "status",
      header: t("admin.providers.status"),
      render: (p) => (
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              p.requestCount > 0 ? "bg-success" : "bg-text-tertiary"
            }`}
          />
          {p.requestCount > 0 ? t("admin.providers.active") : t("admin.providers.idle")}
        </span>
      ),
    },
    {
      key: "offeringCount",
      header: t("admin.providers.offerings"),
      align: "right",
      render: (p) => formatNumber(p.offeringCount),
    },
    {
      key: "requestCount",
      header: t("admin.usage.requests"),
      align: "right",
      render: (p) => formatNumber(p.requestCount),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.providers.title")}</h1>
      <DataTable
        columns={columns}
        data={providers}
        rowKey={(p) => p.providerType}
        emptyText={t("common.empty")}
      />
    </div>
  );
}
