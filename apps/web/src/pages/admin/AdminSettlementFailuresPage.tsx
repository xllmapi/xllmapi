import { useState } from "react";
import { apiJson } from "@/lib/api";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { FormButton } from "@/components/ui/FormButton";
import { Badge } from "@/components/ui/Badge";
import { formatNumber } from "@/lib/utils";

type FailureStatus = "open" | "resolved" | "all";

interface SettlementFailureRow {
  id: string;
  requestId: string;
  requesterEmail: string;
  supplierEmail: string;
  logicalModel: string;
  provider: string;
  errorMessage: string;
  failureCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  resolvedAt?: string | null;
}

export function AdminSettlementFailuresPage() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [status, setStatus] = useState<FailureStatus>("open");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    status
  });

  const { data: raw, loading, refetch } = useCachedFetch<{ data: SettlementFailureRow[]; total: number }>(`/v1/admin/settlement-failures?${params}`);
  const rows = raw?.data ?? [];
  const total = raw?.total ?? 0;

  const handleRetry = async (failureId: string) => {
    setRetryingId(failureId);
    try {
      await apiJson(`/v1/admin/settlement-failures/${encodeURIComponent(failureId)}/retry`, {
        method: "POST"
      });
      void refetch();
    } finally {
      setRetryingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const openCount = rows.filter((row) => !row.resolvedAt).length;
  const resolvedCount = rows.filter((row) => row.resolvedAt).length;

  const columns: Column<SettlementFailureRow>[] = [
    {
      key: "lastFailedAt",
      header: t("admin.settlementFailures.lastFailedAt"),
      render: (row) => (
        <span className="text-text-tertiary text-xs whitespace-nowrap">
          {new Date(row.lastFailedAt).toLocaleString()}
        </span>
      )
    },
    {
      key: "logicalModel",
      header: t("admin.requests.model"),
      className: "font-mono text-xs"
    },
    {
      key: "requesterEmail",
      header: t("admin.settlementFailures.requester"),
      render: (row) => <span className="text-text-secondary text-xs">{row.requesterEmail}</span>
    },
    {
      key: "supplierEmail",
      header: t("admin.settlementFailures.supplier"),
      render: (row) => <span className="text-text-secondary text-xs">{row.supplierEmail}</span>
    },
    {
      key: "errorMessage",
      header: t("admin.settlementFailures.error"),
      render: (row) => <span className="text-text-secondary text-xs">{row.errorMessage}</span>
    },
    {
      key: "failureCount",
      header: t("admin.settlementFailures.failures"),
      align: "right",
      render: (row) => <span className="text-xs">{formatNumber(row.failureCount)}</span>
    },
    {
      key: "resolvedAt",
      header: t("admin.requests.status"),
      render: (row) => (
        <Badge variant={row.resolvedAt ? "success" : "danger"}>
          {row.resolvedAt ? t("admin.settlementFailures.resolved") : t("admin.settlementFailures.open")}
        </Badge>
      )
    },
    {
      key: "actions",
      header: t("common.actions"),
      align: "right",
      render: (row) => row.resolvedAt ? (
        <span className="text-xs text-text-tertiary">{t("admin.settlementFailures.resolved")}</span>
      ) : (
        <FormButton
          variant="ghost"
          onClick={() => void handleRetry(row.id)}
          disabled={retryingId === row.id}
          className="!px-3 !py-1.5 !text-xs"
        >
          {retryingId === row.id ? t("common.loading") : t("admin.settlementFailures.retry")}
        </FormButton>
      )
    }
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.settlementFailures.title")}</h1>
        <div className="flex gap-1">
          {(["open", "resolved", "all"] as FailureStatus[]).map((value) => (
            <FormButton
              key={value}
              variant={status === value ? "primary" : "ghost"}
              onClick={() => { setStatus(value); setPage(1); }}
              className="!px-3 !py-1.5 !text-xs"
            >
              {t(`admin.settlementFailures.filter.${value}`)}
            </FormButton>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-4">
              <p className="text-xs text-text-tertiary mb-1">{t("admin.settlementFailures.total")}</p>
              <p className="text-xl font-semibold">{formatNumber(total)}</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-4">
              <p className="text-xs text-text-tertiary mb-1">{t("admin.settlementFailures.open")}</p>
              <p className="text-xl font-semibold text-danger">{formatNumber(openCount)}</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-4">
              <p className="text-xs text-text-tertiary mb-1">{t("admin.settlementFailures.resolved")}</p>
              <p className="text-xl font-semibold text-success">{formatNumber(resolvedCount)}</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-4">
              <p className="text-xs text-text-tertiary mb-1">{t("admin.settlementFailures.page")}</p>
              <p className="text-xl font-semibold">{page} / {totalPages}</p>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={rows}
            rowKey={(row) => row.id}
            emptyText={t("common.empty")}
            loading={loading}
            rowClassName={(row) => row.resolvedAt ? "" : "bg-danger/3"}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <FormButton
                variant="ghost"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
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
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
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
