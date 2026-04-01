import { useLocale } from "@/hooks/useLocale";
import { useAdminData } from "@/hooks/useAdminData";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface ReleaseRecord {
  releaseId: string;
  deployedAt: string;
  gitCommit: string;
  backupPath: string | null;
  status: string;
}

export function AdminReleasesPage() {
  const { t } = useLocale();
  const { data: raw, loading } = useAdminData<{ data: ReleaseRecord[] }>("/v1/admin/releases");
  const data = raw?.data ?? [];

  const columns: Column<ReleaseRecord>[] = [
    {
      key: "releaseId",
      header: t("admin.releases.version"),
      render: (r) => (
        <span className="font-mono text-xs">{r.releaseId}</span>
      ),
    },
    {
      key: "deployedAt",
      header: t("admin.releases.time"),
      render: (r) => (
        <span className="text-text-secondary text-xs whitespace-nowrap">
          {r.deployedAt ? new Date(r.deployedAt).toLocaleString() : "-"}
        </span>
      ),
    },
    {
      key: "gitCommit",
      header: "Git Commit",
      render: (r) => (
        <span className="font-mono text-xs text-text-secondary">
          {r.gitCommit ? r.gitCommit.slice(0, 7) : "-"}
        </span>
      ),
    },
    {
      key: "backupPath",
      header: t("admin.releases.backup"),
      render: (r) => (
        <span className="text-xs text-text-tertiary">
          {r.backupPath ? <Badge variant="success">OK</Badge> : <Badge variant="default">-</Badge>}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.releases.status"),
      render: (r) => (
        <Badge variant={r.status === "success" ? "success" : r.status === "failed" ? "danger" : "default"}>
          {r.status}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.releases.title")}</h1>
      </div>

      <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.releaseId}
          emptyText={t("common.empty")}
          loading={loading}
        />
    </div>
  );
}
