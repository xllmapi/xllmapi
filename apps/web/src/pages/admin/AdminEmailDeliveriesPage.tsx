import { useEffect, useMemo, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";

type EmailDelivery = {
  id: string;
  provider: string;
  templateKey: string;
  toEmail: string;
  subject: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
};

export function AdminEmailDeliveriesPage() {
  const { t } = useLocale();
  const [rows, setRows] = useState<EmailDelivery[]>([]);

  useEffect(() => {
    void apiJson<{ data: EmailDelivery[] }>("/v1/admin/email-deliveries?limit=100")
      .then((result) => setRows(result.data ?? []))
      .catch(() => setRows([]));
  }, []);

  const columns = useMemo<Column<EmailDelivery>[]>(() => [
    { key: "createdAt", header: t("admin.emailDeliveries.time") },
    { key: "templateKey", header: t("admin.emailDeliveries.template") },
    { key: "toEmail", header: t("admin.emailDeliveries.to") },
    { key: "provider", header: t("admin.emailDeliveries.provider") },
    { key: "status", header: t("admin.emailDeliveries.status") },
    {
      key: "errorMessage",
      header: t("admin.emailDeliveries.error"),
      render: (row) => row.errorMessage || "-"
    }
  ], [t]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.emailDeliveries.title")}</h1>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        emptyText={t("admin.emailDeliveries.empty")}
      />
    </div>
  );
}
