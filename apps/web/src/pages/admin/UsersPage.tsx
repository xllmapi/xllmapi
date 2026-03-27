import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: string;
  balance: number;
  lastLoginAt: string;
  lastLoginIp: string | null;
  status: string;
  createdAt: string;
}

type FilterTab = "all" | "active" | "admin";

export function UsersPage() {
  const { t } = useLocale();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [acting, setActing] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await apiJson<{ data: AdminUser[] }>("/v1/admin/users");
      setUsers(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSetRole = async (id: string, role: string) => {
    const newRole = role === "admin" ? "user" : "admin";
    setActing(id);
    try {
      await apiJson(`/v1/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      await loadData();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  };

  const handleToggleStatus = async (id: string, status: string) => {
    const newStatus = status === "active" ? "disabled" : "active";
    setActing(id);
    try {
      await apiJson(`/v1/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      await loadData();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  };

  const handleAdjustBalance = async (id: string) => {
    const amount = window.prompt(t("admin.users.adjustPrompt"));
    if (amount === null) return;
    const num = Number(amount);
    if (isNaN(num)) return;
    setActing(id);
    try {
      await apiJson(`/v1/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ walletAdjust: num }),
      });
      await loadData();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = users.filter((u) => {
    const matchSearch =
      !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.displayName ?? "").toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === "admin") return u.role === "admin";
    if (filter === "active") return u.lastLoginAt && new Date(u.lastLoginAt).getTime() > sevenDaysAgo;
    return true;
  });

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: t("admin.users.filterAll") },
    { key: "active", label: t("admin.users.filterActive") },
    { key: "admin", label: t("admin.users.filterAdmin") },
  ];

  const columns: Column<AdminUser>[] = [
    { key: "email", header: t("admin.users.email") },
    {
      key: "handle",
      header: t("admin.users.handle"),
      render: (u) => <span className="text-text-secondary text-xs font-mono">{u.handle || "\u2014"}</span>,
    },
    {
      key: "displayName",
      header: t("admin.users.nickname"),
      render: (u) => <span className="text-text-secondary">{u.displayName || "\u2014"}</span>,
    },
    {
      key: "role",
      header: t("admin.users.role"),
      render: (u) => <Badge>{u.role}</Badge>,
    },
    {
      key: "balance",
      header: t("admin.users.balance"),
      align: "right",
      render: (u) => <span className="font-mono text-xs">{formatTokens(u.balance ?? 0)}</span>,
    },
    {
      key: "lastLoginAt",
      header: t("admin.users.lastLogin"),
      render: (u) => (
        <span className="text-text-secondary text-xs">
          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "\u2014"}
        </span>
      ),
    },
    {
      key: "lastLoginIp",
      header: t("admin.users.ip"),
      render: (u) => (
        <span className="text-text-secondary text-xs font-mono">
          {u.lastLoginIp || "\u2014"}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.users.status"),
      render: (u) => <Badge>{u.status || "active"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (u) => (
        <div className="flex gap-1.5">
          <button
            onClick={() => void handleSetRole(u.id, u.role)}
            disabled={acting === u.id}
            className="text-xs text-accent hover:underline cursor-pointer bg-transparent border-none disabled:opacity-50"
          >
            {u.role === "admin" ? t("admin.users.setUser") : t("admin.users.setAdmin")}
          </button>
          <button
            onClick={() => void handleToggleStatus(u.id, u.status)}
            disabled={acting === u.id}
            className="text-xs text-accent hover:underline cursor-pointer bg-transparent border-none disabled:opacity-50"
          >
            {u.status === "disabled" ? t("admin.users.enable") : t("admin.users.disable")}
          </button>
          <button
            onClick={() => void handleAdjustBalance(u.id)}
            disabled={acting === u.id}
            className="text-xs text-accent hover:underline cursor-pointer bg-transparent border-none disabled:opacity-50"
          >
            {t("admin.users.adjust")}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.users.title")}</h1>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <FormInput
          placeholder={t("admin.users.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <FormButton
              key={tab.key}
              variant={filter === tab.key ? "primary" : "ghost"}
              onClick={() => setFilter(tab.key)}
              className="!px-3 !py-1.5 !text-xs"
            >
              {tab.label}
            </FormButton>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(u) => u.id}
        emptyText={t("admin.users.noUsers")}
      />
    </div>
  );
}
