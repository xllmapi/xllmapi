import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

interface InvitationStats {
  remaining: number;
  total: number;
  used: number;
}

interface Invitation {
  id: string;
  invitedEmail: string;
  status: string;
  note: string;
  acceptedAt: string | null;
  createdAt: string;
}

export function InvitationsPage() {
  const { t } = useLocale();
  const [stats, setStats] = useState<InvitationStats | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [statsRes, invRes] = await Promise.all([
        apiJson<{ data: InvitationStats }>("/v1/me/invitation-stats"),
        apiJson<{ data: Invitation[] }>("/v1/invitations"),
      ]);
      setStats(statsRes.data);
      setInvitations(invRes.data ?? []);
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
      await apiJson("/v1/invitations", {
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

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const handleRevoke = async (invId: string) => {
    try {
      await apiJson(`/v1/invitations/${encodeURIComponent(invId)}/revoke`, { method: "POST" });
      await loadData();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "error" in err
        ? (err as { error: { message: string } }).error.message
        : "Failed to revoke";
      setError(msg);
    }
  };

  const columns: Column<Invitation>[] = [
    {
      key: "invitedEmail",
      header: t("invitations.email"),
      render: (inv) => <span className="font-mono text-xs">{inv.invitedEmail}</span>,
    },
    {
      key: "status",
      header: t("invitations.status"),
      render: (inv) => <Badge>{inv.status}</Badge>,
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
      key: "acceptedAt",
      header: t("invitations.acceptedAt"),
      render: (inv) => (
        <span className="text-text-secondary text-xs">
          {inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "id",
      header: "",
      render: (inv) =>
        inv.status === "pending" ? (
          <button
            onClick={() => void handleRevoke(inv.id)}
            className="text-danger text-xs cursor-pointer bg-transparent border border-danger/30 rounded-[var(--radius-btn)] px-3 py-1 hover:bg-danger/10 transition-colors"
          >
            {t("invitations.revoke")}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("invitations.title")}</h1>

      {/* Quota */}
      {stats && (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <p className="text-text-secondary text-sm">
            {t("invitations.quota")}:{" "}
            <span className="text-text-primary font-medium">{stats.used}</span> / {stats.total} {t("invitations.used")}
            {" · "}
            <span className="text-accent font-medium">{stats.remaining}</span> {t("invitations.remaining")}
          </p>
        </div>
      )}

      {/* Send Invitation */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("invitations.send")}</h2>
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

      {/* Invitations List */}
      <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("invitations.sent")}</h2>
      <DataTable
        columns={columns}
        data={invitations}
        rowKey={(inv) => inv.id}
        emptyText={t("invitations.noRecords")}
      />
    </div>
  );
}
