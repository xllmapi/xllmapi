import { useState } from "react";
import { apiJson } from "@/lib/api";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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
  offeringCount: number;
  totalRequests: number;
  totalTokens: number;
  todayRequests: number;
  todayTokens: number;
}

type FilterTab = "all" | "active" | "admin";

interface DialogState {
  open: boolean;
  title: string;
  description: string;
  variant: "warning" | "danger";
  userId: string;
  actionType: "setRole" | "toggleStatus" | "adjustBalance";
  actionArgs: { role?: string; status?: string; currentBalance?: number };
  input?: { label: string; placeholder?: string; type?: string };
  inputs?: Array<{ key: string; label: string; placeholder?: string; type?: string }>;
  renderExtra?: (inputValues: Record<string, string>) => React.ReactNode;
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-text-tertiary text-xs w-28 shrink-0">{label}</span>
      <span className={`text-text-primary text-xs break-all ${mono ? "font-mono" : ""}`}>{value ?? "-"}</span>
    </div>
  );
}

function UserDetailPanel({ user, acting, onSetRole, onToggleStatus, onAdjustBalance, onClose, t }: {
  user: AdminUser;
  acting: string | null;
  onSetRole: (user: AdminUser) => void;
  onToggleStatus: (user: AdminUser) => void;
  onAdjustBalance: (user: AdminUser) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="border-t border-line bg-[rgba(16,21,34,0.4)] px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{t("admin.users.detailTitle")}</h3>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xs cursor-pointer">
          {t("common.close")}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2">
        {/* Basic Info */}
        <div className="mb-3">
          <h4 className="text-xs font-medium text-accent mb-1">{t("admin.users.basicInfo")}</h4>
          <DetailRow label="Handle" value={user.handle} mono />
          <DetailRow label={t("admin.users.email")} value={user.email} />
          <DetailRow label={t("admin.users.joined")} value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"} />
          <DetailRow label={t("admin.users.lastLogin")} value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-"} />
          <DetailRow label={t("admin.users.ip")} value={user.lastLoginIp || "-"} mono />
        </div>
        {/* Account Info */}
        <div className="mb-3">
          <h4 className="text-xs font-medium text-accent mb-1">{t("admin.users.accountInfo")}</h4>
          <DetailRow label={t("admin.users.role")} value={<Badge>{user.role}</Badge>} />
          <DetailRow label={t("admin.users.balance")} value={formatTokens(user.balance ?? 0)} mono />
          <DetailRow label={t("admin.users.status")} value={<Badge>{user.status || "active"}</Badge>} />
        </div>
        {/* Usage Overview */}
        <div className="mb-3">
          <h4 className="text-xs font-medium text-accent mb-1">{t("admin.users.usageOverview")}</h4>
          <DetailRow label={t("admin.users.offeringCount")} value={String(user.offeringCount ?? 0)} />
          <DetailRow label={t("admin.users.totalReqs")} value={String(user.totalRequests ?? 0)} />
          <DetailRow label={t("admin.users.totalTokensLabel")} value={formatTokens(user.totalTokens ?? 0)} />
          <DetailRow label={t("admin.users.todayReqs")} value={String(user.todayRequests ?? 0)} />
          <DetailRow label={t("admin.users.todayTokensLabel")} value={formatTokens(user.todayTokens ?? 0)} />
        </div>
      </div>
      {/* Actions */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-line/50">
        <FormButton variant="ghost" onClick={(e) => { e.stopPropagation(); onSetRole(user); }} disabled={acting === user.id} className="!px-3 !py-1.5 !text-xs">
          {user.role === "admin" ? t("admin.users.setUser") : t("admin.users.setAdmin")}
        </FormButton>
        <FormButton variant="ghost" onClick={(e) => { e.stopPropagation(); onToggleStatus(user); }} disabled={acting === user.id} className="!px-3 !py-1.5 !text-xs text-danger">
          {user.status === "disabled" ? t("admin.users.enable") : t("admin.users.disable")}
        </FormButton>
        <FormButton variant="ghost" onClick={(e) => { e.stopPropagation(); onAdjustBalance(user); }} disabled={acting === user.id} className="!px-3 !py-1.5 !text-xs">
          {t("admin.users.adjust")}
        </FormButton>
      </div>
    </div>
  );
}

export function UsersPage() {
  const { t } = useLocale();
  const { data: raw, loading, refetch } = useCachedFetch<{ data: AdminUser[] }>("/v1/admin/users");
  const users = raw?.data ?? [];
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [acting, setActing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<DialogState | null>(null);

  /* ---- Action handlers ---- */

  const handleSetRole = async (id: string, role: string) => {
    const newRole = role === "admin" ? "user" : "admin";
    setActing(id);
    try {
      await apiJson(`/v1/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      await refetch();
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
      await refetch();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  };

  const handleAdjustBalance = async (id: string, amount: number, note?: string) => {
    setActing(id);
    try {
      await apiJson(`/v1/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ walletAdjust: amount, ...(note ? { walletAdjustNote: note } : {}) }),
      });
      await refetch();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  };

  /* ---- ConfirmDialog openers ---- */

  const openSetRoleDialog = (user: AdminUser) => {
    const newRole = user.role === "admin" ? "user" : "admin";
    setConfirmDialog({
      open: true,
      title: t("admin.users.confirmRoleTitle"),
      description: newRole === "admin"
        ? t("admin.users.confirmSetAdmin").replace("{name}", user.displayName || user.email)
        : t("admin.users.confirmSetUser").replace("{name}", user.displayName || user.email),
      variant: "warning",
      userId: user.id,
      actionType: "setRole",
      actionArgs: { role: user.role },
    });
  };

  const openToggleStatusDialog = (user: AdminUser) => {
    const willDisable = user.status !== "disabled";
    setConfirmDialog({
      open: true,
      title: willDisable ? t("admin.users.confirmDisableTitle") : t("admin.users.confirmEnableTitle"),
      description: willDisable
        ? t("admin.users.confirmDisable").replace("{name}", user.displayName || user.email)
        : t("admin.users.confirmEnable").replace("{name}", user.displayName || user.email),
      variant: willDisable ? "danger" : "warning",
      userId: user.id,
      actionType: "toggleStatus",
      actionArgs: { status: user.status },
    });
  };

  const openAdjustBalanceDialog = (user: AdminUser) => {
    setConfirmDialog({
      open: true,
      title: t("admin.users.confirmAdjustTitle"),
      description: `${t("admin.users.confirmAdjust").replace("{name}", user.displayName || user.email)}\n${t("admin.users.currentBalance")}: ${formatTokens(user.balance)} xtokens`,
      variant: "warning",
      userId: user.id,
      actionType: "adjustBalance",
      actionArgs: { currentBalance: user.balance },
      inputs: [
        { key: "amount", label: t("admin.users.adjustPrompt"), placeholder: "100000", type: "number" },
        { key: "note", label: t("admin.users.adjustNote"), placeholder: t("admin.users.adjustNotePlaceholder"), type: "text" },
      ],
      renderExtra: (inputValues) => {
        const amt = Number(inputValues.amount || 0);
        if (!amt || isNaN(amt)) return null;
        const newBalance = Number(user.balance) + amt;
        return (
          <div className="rounded-lg border border-line bg-bg-2/50 p-3 text-xs">
            <div className="flex justify-between text-text-tertiary">
              <span>{t("admin.users.currentBalance")}</span>
              <span className="font-mono">{formatTokens(user.balance)} xtokens</span>
            </div>
            <div className="flex justify-between text-text-tertiary mt-1">
              <span>{t("admin.users.adjustAmount")}</span>
              <span className={`font-mono ${amt >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                {amt >= 0 ? "+" : ""}{formatTokens(amt)}
              </span>
            </div>
            <div className="border-t border-line mt-2 pt-2 flex justify-between font-medium text-text-primary">
              <span>{t("admin.users.newBalance")}</span>
              <span className={`font-mono ${newBalance < 0 ? "text-danger" : ""}`}>
                {formatTokens(newBalance)} xtokens
              </span>
            </div>
          </div>
        );
      },
    });
  };

  const handleConfirmAction = (inputValue?: string, inputValues?: Record<string, string>) => {
    if (!confirmDialog) return;
    const { userId, actionType, actionArgs } = confirmDialog;
    if (actionType === "setRole") {
      void handleSetRole(userId, actionArgs.role!);
    } else if (actionType === "toggleStatus") {
      void handleToggleStatus(userId, actionArgs.status!);
    } else if (actionType === "adjustBalance") {
      // Support both single input (backward compat) and multi-input
      const amountStr = inputValues?.amount ?? inputValue;
      if (amountStr) {
        const num = Number(amountStr);
        if (!isNaN(num)) {
          void handleAdjustBalance(userId, num, inputValues?.note || undefined);
        }
      }
    }
    setConfirmDialog(null);
  };

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
      key: "status",
      header: t("admin.users.status"),
      render: (u) => <Badge>{u.status || "active"}</Badge>,
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
        loading={loading}
        onRowClick={(u) => setExpandedId(expandedId === u.id ? null : u.id)}
        activeRowKey={expandedId}
        renderExpanded={(u) =>
          expandedId === u.id ? (
            <UserDetailPanel
              user={u}
              acting={acting}
              onSetRole={openSetRoleDialog}
              onToggleStatus={openToggleStatusDialog}
              onAdjustBalance={openAdjustBalanceDialog}
              onClose={() => setExpandedId(null)}
              t={t}
            />
          ) : null
        }
      />

      {confirmDialog && (
        <ConfirmDialog
          open={confirmDialog.open}
          onClose={() => setConfirmDialog(null)}
          onConfirm={handleConfirmAction}
          title={confirmDialog.title}
          description={confirmDialog.description}
          variant={confirmDialog.variant}
          input={confirmDialog.input}
          inputs={confirmDialog.inputs}
          renderExtra={confirmDialog.renderExtra}
        />
      )}
    </div>
  );
}
