import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber, formatTokens } from "@/lib/utils";
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
  realModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  status: string;
  chosenOfferingId: string;
}

type TimeRange = 7 | 30 | 0;

export function AdminRequestsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<RequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<TimeRange>(7);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [modelFilter, setModelFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (days > 0) params.set("days", String(days));
    if (modelFilter) params.set("model", modelFilter);
    if (providerFilter) params.set("provider", providerFilter);
    if (userFilter) params.set("user", userFilter);

    apiJson<{ data: RequestRow[]; total: number }>(`/v1/admin/requests?${params}`)
      .then((r) => {
        setData(r.data ?? []);
        setTotal(r.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, limit, days, modelFilter, providerFilter, userFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      render: (r) => (
        <span className="text-text-tertiary text-xs whitespace-nowrap">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "userEmail",
      header: t("admin.requests.user"),
      render: (r) => (
        <span className="text-text-secondary text-xs">{r.userName || r.userEmail}</span>
      ),
    },
    {
      key: "logicalModel",
      header: t("admin.requests.model"),
      className: "font-mono text-xs",
    },
    {
      key: "provider",
      header: t("admin.requests.provider"),
      render: (r) => <span className="text-text-secondary text-xs">{r.provider}</span>,
    },
    {
      key: "inputTokens",
      header: t("admin.requests.inTokens"),
      align: "right",
      render: (r) => <span className="text-text-secondary text-xs">{formatTokens(r.inputTokens)}</span>,
    },
    {
      key: "outputTokens",
      header: t("admin.requests.outTokens"),
      align: "right",
      render: (r) => <span className="text-text-secondary text-xs">{formatTokens(r.outputTokens)}</span>,
    },
    {
      key: "totalTokens",
      header: t("admin.requests.total"),
      align: "right",
      render: (r) => <span className="font-medium text-xs">{formatTokens(r.totalTokens)}</span>,
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

      {loading ? (
        <p className="text-text-secondary py-8">{t("common.loading")}</p>
      ) : (
        <>
          <div className="text-xs text-text-tertiary mb-2">
            {t("admin.requests.totalCount")}: {formatNumber(total)}
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
