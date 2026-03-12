import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export function UsersPage() {
  const { t } = useLocale();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ data: AdminUser[] }>("/v1/admin/users")
      .then((r) => setUsers(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const columns: Column<AdminUser>[] = [
    { key: "email", header: t("admin.users.email") },
    {
      key: "displayName",
      header: t("admin.users.nickname"),
      render: (u) => <span className="text-text-secondary">{u.displayName || "—"}</span>,
    },
    {
      key: "role",
      header: t("admin.users.role"),
      render: (u) => <Badge>{u.role}</Badge>,
    },
    {
      key: "createdAt",
      header: t("admin.users.joined"),
      render: (u) => (
        <span className="text-text-secondary">
          {new Date(u.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.users.title")}</h1>
      <DataTable
        columns={columns}
        data={users}
        rowKey={(u) => u.id}
        emptyText={t("admin.users.noUsers")}
      />
    </div>
  );
}
