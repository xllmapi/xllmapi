import { useMemo } from "react";
import { useLocale } from "@/hooks/useLocale";
import { useAdminData } from "@/hooks/useAdminData";
import { DataTable, type Column } from "@/components/ui/DataTable";

type SecurityEventRow = {
  id: string;
  userId: string;
  email?: string | null;
  type: string;
  severity: string;
  ipAddress?: string | null;
  createdAt: string;
};

export function AdminSecurityEventsPage() {
  const { t } = useLocale();
  const { data: raw } = useAdminData<{ data: SecurityEventRow[] }>("/v1/admin/security-events?limit=100");
  const rows = raw?.data ?? [];

  const columns = useMemo<Column<SecurityEventRow>[]>(() => [
    { key: "createdAt", header: t("admin.securityEvents.time") },
    { key: "type", header: t("admin.securityEvents.type") },
    { key: "severity", header: t("admin.securityEvents.severity") },
    { key: "email", header: t("admin.securityEvents.email") },
    { key: "ipAddress", header: t("admin.securityEvents.ip") }
  ], [t]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.securityEvents.title")}</h1>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        emptyText={t("admin.securityEvents.empty")}
      />
    </div>
  );
}
