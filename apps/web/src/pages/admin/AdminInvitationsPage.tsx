import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

interface Invitation {
  id: string;
  email: string;
  status: string;
  invitedBy: string;
  note: string;
  createdAt: string;
}

export function AdminInvitationsPage() {
  const { t } = useLocale();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
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

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const columns: Column<Invitation>[] = [
    { key: "email", header: t("admin.users.email") },
    {
      key: "invitedBy",
      header: t("admin.invitations.invitedBy"),
      render: (inv) => <span className="text-text-secondary">{inv.invitedBy || "admin"}</span>,
    },
    {
      key: "status",
      header: t("invitations.status"),
      render: (inv) => <Badge>{inv.status}</Badge>,
    },
    {
      key: "note",
      header: t("invitations.note"),
      render: (inv) => <span className="text-text-secondary">{inv.note || "—"}</span>,
    },
    {
      key: "createdAt",
      header: t("invitations.date"),
      render: (inv) => (
        <span className="text-text-secondary">
          {new Date(inv.createdAt).toLocaleDateString()}
        </span>
      ),
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
