import { useState } from "react";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { formatNumber, formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { FormButton } from "@/components/ui/FormButton";

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  consumerCount: number;
  offeringCount: number;
}

interface TopModel {
  logicalModel: string;
  requestCount: number;
  totalTokens: number;
}

interface TopConsumer {
  email: string;
  requestCount: number;
  totalTokens: number;
}

interface UsageResponse {
  summary: UsageSummary;
  topModels: TopModel[];
  topConsumers: TopConsumer[];
}

type TimeRange = 7 | 30 | 0;

export function UsagePage() {
  const { t } = useLocale();
  const [days, setDays] = useState<TimeRange>(7);
  const query = days > 0 ? `?days=${days}` : "";
  const { data: raw, loading } = useCachedFetch<{ data: UsageResponse }>(`/v1/admin/usage${query}`);
  const data = raw?.data ?? null;

  const timeRanges: { key: TimeRange; label: string }[] = [
    { key: 7, label: "7d" },
    { key: 30, label: "30d" },
    { key: 0, label: t("admin.usage.allTime") },
  ];

  const maxRequests = Math.max(...(data?.topModels?.map((m) => m.requestCount) ?? [1]));

  const modelColumns: Column<TopModel>[] = [
    {
      key: "logicalModel",
      header: t("admin.usage.model"),
      className: "font-mono text-xs",
    },
    {
      key: "requestCount",
      header: t("admin.usage.requests"),
      align: "right",
      render: (m) => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-20 h-1.5 bg-line rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full"
              style={{ width: `${(m.requestCount / maxRequests) * 100}%` }}
            />
          </div>
          <span className="text-xs min-w-[3rem] text-right">{formatNumber(m.requestCount)}</span>
        </div>
      ),
    },
    {
      key: "totalTokens",
      header: t("admin.usage.tokens"),
      align: "right",
      render: (m) => <span className="text-text-secondary">{formatTokens(m.totalTokens)}</span>,
    },
  ];

  const consumerColumns: Column<TopConsumer>[] = [
    { key: "email", header: t("admin.users.email") },
    {
      key: "requestCount",
      header: t("admin.usage.requests"),
      align: "right",
      render: (c) => formatNumber(c.requestCount),
    },
    {
      key: "totalTokens",
      header: t("admin.usage.tokens"),
      align: "right",
      render: (c) => <span className="text-text-secondary">{formatTokens(c.totalTokens)}</span>,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.usage.title")}</h1>
        <div className="flex gap-1">
          {timeRanges.map((r) => (
            <FormButton
              key={r.key}
              variant={days === r.key ? "primary" : "ghost"}
              onClick={() => setDays(r.key)}
              className="!px-3 !py-1.5 !text-xs"
            >
              {r.label}
            </FormButton>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label={t("admin.usage.totalRequests")} value={formatNumber(data?.summary?.totalRequests ?? 0)} loading={loading} />
            <StatCard label={t("admin.usage.totalTokens")} value={`${formatTokens(data?.summary?.totalTokens ?? 0)} xtokens`} loading={loading} />
            <StatCard label={t("admin.usage.consumers")} value={formatNumber(data?.summary?.consumerCount ?? 0)} loading={loading} />
            <StatCard label={t("admin.overview.models")} value={formatNumber(data?.summary?.offeringCount ?? 0)} loading={loading} />
          </div>

          {data?.topModels && data.topModels.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.usage.topModels")}</h2>
              <DataTable
                columns={modelColumns}
                data={data.topModels}
                rowKey={(m) => m.logicalModel}
              />
            </div>
          )}

          {data?.topConsumers && data.topConsumers.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.usage.topConsumers")}</h2>
              <DataTable
                columns={consumerColumns}
                data={data.topConsumers}
                rowKey={(c) => c.email}
              />
            </div>
          )}
    </div>
  );
}
