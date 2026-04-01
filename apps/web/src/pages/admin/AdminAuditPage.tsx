import { useLocale } from "@/hooks/useLocale";
import { useAdminData } from "@/hooks/useAdminData";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface AuditRow {
  id: string;
  actor_user_id: string;
  actorName: string;
  action: string;
  target_type: string;
  target_id: string;
  payload: unknown;
  created_at: string;
}

export function AdminAuditPage() {
  const { t } = useLocale();
  const { data: raw, loading } = useAdminData<{ data: AuditRow[] }>("/v1/admin/audit-logs?limit=100");
  const data = raw?.data ?? [];

  const columns: Column<AuditRow>[] = [
    {
      key: "created_at",
      header: t("admin.audit.time"),
      render: (r) => (
        <span className="text-text-tertiary text-xs whitespace-nowrap">
          {new Date(r.created_at).toLocaleString()}
        </span>
      ),
    },
    {
      key: "actorName",
      header: t("admin.audit.actor"),
      render: (r) => (
        <span className="text-text-secondary text-xs">{r.actorName || r.actor_user_id?.slice(0, 8)}</span>
      ),
    },
    {
      key: "action",
      header: t("admin.audit.action"),
      className: "font-mono text-xs",
    },
    {
      key: "target_type",
      header: t("admin.audit.targetType"),
      render: (r) => <span className="text-text-secondary text-xs">{r.target_type}</span>,
    },
    {
      key: "target_id",
      header: t("admin.audit.targetId"),
      render: (r) => <span className="text-text-tertiary text-xs font-mono">{r.target_id?.slice(0, 12)}</span>,
    },
    {
      key: "payload",
      header: t("admin.audit.details"),
      render: (r) => (
        <span className="text-text-tertiary text-xs font-mono max-w-[200px] truncate block">
          {r.payload ? JSON.stringify(r.payload) : "-"}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight mb-6">{t("admin.audit.title")}</h1>

      {loading ? (
        <p className="text-text-secondary py-8">{t("common.loading")}</p>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id ?? `${r.created_at}-${r.action}`}
          emptyText={t("common.empty")}
        />
      )}
    </div>
  );
}
