import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

interface Invitation {
  id: string;
  invitedEmail: string;
  status: string;
  inviterDisplayName: string;
  note: string;
  expiresAt: string;
  createdAt: string;
}

interface AllInvitation {
  id: string;
  invitedEmail: string;
  status: string;
  inviterName: string;
  inviterEmail: string;
  note: string;
  expiresAt: string;
  createdAt: string;
}

interface ConfigItem {
  key: string;
  value: string;
}

export function AdminInvitationsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<"admin" | "all">("admin");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [allInvitations, setAllInvitations] = useState<AllInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [allLoading, setAllLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [invitationEnabled, setInvitationEnabled] = useState(true);
  const [quota, setQuota] = useState<string>("10");
  const [toggling, setToggling] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiJson<{ data: ConfigItem[] }>("/v1/admin/config");
      const items = res.data ?? [];
      const enabledItem = items.find((c) => c.key === "invitation_enabled");
      const quotaItem = items.find((c) => c.key === "default_invitation_quota");
      if (enabledItem) setInvitationEnabled(enabledItem.value !== "false");
      if (quotaItem) setQuota(quotaItem.value);
    } catch {
      // ignore
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await apiJson<{ data: Invitation[] }>("/v1/admin/invitations");
      setInvitations(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAllInvitations = useCallback(async () => {
    setAllLoading(true);
    try {
      const res = await apiJson<{ data: AllInvitation[] }>("/v1/admin/invitations/all");
      setAllInvitations(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setAllLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void loadConfig();
  }, [loadData, loadConfig]);

  useEffect(() => {
    if (tab === "all" && allInvitations.length === 0) {
      void loadAllInvitations();
    }
  }, [tab, allInvitations.length, loadAllInvitations]);

  const handleToggleEnabled = async () => {
    setToggling(true);
    try {
      const newValue = invitationEnabled ? "false" : "true";
      await apiJson("/v1/admin/config", {
        method: "PUT",
        body: JSON.stringify({ key: "invitation_enabled", value: newValue }),
      });
      setInvitationEnabled(!invitationEnabled);
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!email.trim()) return;
    setSending(true);
    try {
      await apiJson("/v1/admin/invitations", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), note: note.trim() }),
      });
      setSuccess(`${t("invitations.sentTo")} ${email}`);
      setEmail("");
      setNote("");
      await loadData();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? (err as { error: { message: string } }).error.message
          : "Failed to send invitation";
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await apiJson(`/v1/invitations/${id}/revoke`, { method: "POST" });
      await loadData();
    } catch {
      // ignore
    } finally {
      setRevoking(null);
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const statusVariant = (s: string) => {
    switch (s.toLowerCase()) {
      case "pending": return "warning" as const;
      case "accepted": return "success" as const;
      default: return "default" as const;
    }
  };

  const columns: Column<Invitation>[] = [
    {
      key: "invitedEmail",
      header: t("admin.users.email"),
      render: (inv) => <span>{inv.invitedEmail}</span>,
    },
    {
      key: "inviterDisplayName",
      header: t("admin.invitations.invitedBy"),
      render: (inv) => <span className="text-text-secondary">{inv.inviterDisplayName || "admin"}</span>,
    },
    {
      key: "status",
      header: t("invitations.status"),
      render: (inv) => <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>,
    },
    {
      key: "note",
      header: t("invitations.note"),
      render: (inv) => <span className="text-text-secondary">{inv.note || "\u2014"}</span>,
    },
    {
      key: "expiresAt",
      header: t("admin.invitations.expires"),
      render: (inv) => (
        <span className="text-text-tertiary text-xs">
          {inv.status === "pending" && inv.expiresAt
            ? new Date(inv.expiresAt).toLocaleDateString()
            : "\u2014"}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: t("invitations.date"),
      render: (inv) => (
        <span className="text-text-secondary text-xs">
          {new Date(inv.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (inv) =>
        inv.status === "pending" ? (
          <FormButton
            variant="danger"
            onClick={() => void handleRevoke(inv.id)}
            disabled={revoking === inv.id}
            className="!px-3 !py-1 !text-xs"
          >
            {t("invitations.revoke")}
          </FormButton>
        ) : null,
    },
  ];

  const allColumns: Column<AllInvitation>[] = [
    {
      key: "invitedEmail",
      header: t("admin.users.email"),
      render: (inv) => <span>{inv.invitedEmail}</span>,
    },
    {
      key: "inviterName",
      header: t("admin.invitations.inviter"),
      render: (inv) => (
        <span className="text-text-secondary">
          {inv.inviterName || inv.inviterEmail || "\u2014"}
        </span>
      ),
    },
    {
      key: "status",
      header: t("invitations.status"),
      render: (inv) => <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>,
    },
    {
      key: "note",
      header: t("invitations.note"),
      render: (inv) => <span className="text-text-secondary">{inv.note || "\u2014"}</span>,
    },
    {
      key: "createdAt",
      header: t("invitations.date"),
      render: (inv) => (
        <span className="text-text-secondary text-xs">
          {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : "\u2014"}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.invitations.title")}</h1>

      {/* Invitation Controls */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-text-secondary">{t("admin.invitations.enabled")}:</span>
            <button
              onClick={() => void handleToggleEnabled()}
              disabled={toggling}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                invitationEnabled ? "bg-success" : "bg-text-tertiary"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  invitationEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm text-text-secondary">
              {invitationEnabled ? t("admin.invitations.enabledOn") : t("admin.invitations.enabledOff")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-secondary">{t("admin.invitations.quota")}:</span>
            <input
              type="number"
              min="0"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              className="w-20 rounded-[var(--radius-input)] border border-line bg-bg-primary px-2 py-1 text-sm"
            />
            <FormButton
              className="!px-3 !py-1 !text-xs"
              onClick={async () => {
                try {
                  await apiJson("/v1/admin/config", {
                    method: "PUT",
                    body: JSON.stringify({ key: "default_invitation_quota", value: quota }),
                  });
                  setSuccess(t("profile.saved"));
                  setTimeout(() => setSuccess(""), 2000);
                } catch { /* ignore */ }
              }}
            >
              {t("profile.save")}
            </FormButton>
          </div>
        </div>
      </div>

      {/* Admin Invite */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("admin.invitations.invite")}</h2>
        {!invitationEnabled && (
          <div className="mb-4 rounded-[var(--radius-input)] bg-warning/10 border border-warning/30 px-4 py-2.5 text-sm text-warning">
            {t("admin.invitations.disabled")}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-[var(--radius-input)] bg-success/10 border border-success/30 px-4 py-2.5 text-sm text-success">
            {success}
          </div>
        )}
        <form onSubmit={handleInvite} className="flex flex-col gap-4 max-w-lg">
          <FormInput
            type="email"
            placeholder={t("invitations.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <FormInput
            type="text"
            placeholder={t("invitations.note")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <FormButton type="submit" disabled={sending || !email.trim()} className="self-start">
            {sending ? t("invitations.sending") : t("invitations.sendBtn")}
          </FormButton>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-line">
        <button
          onClick={() => setTab("admin")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "admin"
              ? "border-accent text-accent"
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          {t("admin.invitations.adminTab")}
        </button>
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "all"
              ? "border-accent text-accent"
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          {t("admin.invitations.allTab")}
        </button>
      </div>

      {tab === "admin" && (
        <DataTable
          columns={columns}
          data={invitations}
          rowKey={(inv) => inv.id}
          emptyText={t("admin.invitations.noRecords")}
        />
      )}

      {tab === "all" && (
        allLoading ? (
          <p className="text-text-secondary py-8">{t("common.loading")}</p>
        ) : (
          <DataTable
            columns={allColumns}
            data={allInvitations}
            rowKey={(inv) => inv.id}
            emptyText={t("admin.invitations.noRecords")}
          />
        )
      )}
    </div>
  );
}
