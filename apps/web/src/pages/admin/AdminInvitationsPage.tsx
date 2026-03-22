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

export function AdminInvitationsPage() {
  const { t } = useLocale();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.invitations.title")}</h1>

      {/* Admin Invite */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("admin.invitations.invite")}</h2>
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

      {/* All Invitations */}
      <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.invitations.all")}</h2>
      <DataTable
        columns={columns}
        data={invitations}
        rowKey={(inv) => inv.id}
        emptyText={t("admin.invitations.noRecords")}
      />
    </div>
  );
}
