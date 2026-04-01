import { useState } from "react";
import { apiJson } from "@/lib/api";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  created_at: string;
  readCount: number;
}

export function AdminNotificationsPage() {
  const { t } = useLocale();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("announcement");
  const [targetUserId, setTargetUserId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data: raw, loading, refetch } = useCachedFetch<{ data: Notification[]; total: number }>(`/v1/admin/notifications?page=${page}&limit=${PAGE_SIZE}`);
  const notifications = raw?.data ?? [];
  const total = raw?.total ?? 0;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSending(true);
    setMessage(null);
    try {
      await apiJson("/v1/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          type,
          ...(targetUserId.trim() ? { targetHandle: targetUserId.trim() } : {}),
          ...(type === "personal" && sendEmail ? { sendEmail: true } : {}),
        }),
      });
      setMessage({ type: "success", text: t("admin.notifications.sent") });
      setTitle("");
      setContent("");
      setTargetUserId("");
      setSendEmail(false);
      setPage(1);
      await refetch();
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setSending(false);
    }
  };

  const columns: Column<Notification>[] = [
    {
      key: "title",
      header: t("admin.notifications.titleCol"),
      render: (n) => <span className="font-medium">{n.title}</span>,
    },
    {
      key: "type",
      header: t("admin.notifications.type"),
      render: (n) => <Badge>{n.type}</Badge>,
    },
    {
      key: "content",
      header: t("admin.notifications.content"),
      render: (n) => (
        <span className="text-text-secondary text-xs line-clamp-1 max-w-[200px] block">
          {n.content}
        </span>
      ),
    },
    {
      key: "readCount",
      header: t("admin.notifications.readCount"),
      align: "right",
      render: (n) => <span className="text-text-secondary">{n.readCount}</span>,
    },
    {
      key: "created_at",
      header: t("invitations.date"),
      render: (n) => (
        <span className="text-text-tertiary text-xs">
          {new Date(n.created_at).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.notifications.title")}</h1>

      {/* Create Notification */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("admin.notifications.create")}</h2>
        {message && (
          <div
            className={`mb-4 rounded-[var(--radius-input)] px-4 py-2.5 text-sm border ${
              message.type === "success"
                ? "bg-success/10 border-success/30 text-success"
                : "bg-danger/10 border-danger/30 text-danger"
            }`}
          >
            {message.text}
          </div>
        )}
        <form onSubmit={handleSend} className="flex flex-col gap-4 max-w-lg">
          <FormInput
            label={t("admin.notifications.titleCol")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">
              {t("admin.notifications.content")}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              rows={3}
              className="w-full rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">
              {t("admin.notifications.type")}
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors cursor-pointer"
            >
              <option value="announcement">{t("admin.notifications.typeAnnouncement")}</option>
              <option value="system">{t("admin.notifications.typeSystem")}</option>
              <option value="personal">{t("admin.notifications.typePersonal")}</option>
            </select>
          </div>
          {type === "personal" && (
            <>
              <FormInput
                label={t("admin.notifications.targetUser")}
                placeholder="xu-xxxxxxxx"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="rounded border-line"
                />
                {t("admin.notifications.sendEmail")}
              </label>
            </>
          )}
          <FormButton type="submit" disabled={sending || !title.trim() || !content.trim()} className="self-start">
            {sending ? t("common.loading") : t("admin.notifications.send")}
          </FormButton>
        </form>
      </div>

      {/* Sent Notifications */}
      <h2 className="text-sm font-semibold mb-3 text-text-secondary">{t("admin.notifications.sentList")}</h2>
      <DataTable
            columns={columns}
            data={notifications}
            rowKey={(n) => n.id}
            emptyText={t("common.empty")}
            loading={loading}
          />
          {(() => {
            const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            return totalPages > 1 ? (
              <div className="flex items-center justify-center gap-2 mt-4">
                <FormButton variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="!px-3 !py-1.5 !text-xs">
                  &larr;
                </FormButton>
                <span className="text-sm text-text-secondary">{page} / {totalPages}</span>
                <FormButton variant="ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="!px-3 !py-1.5 !text-xs">
                  &rarr;
                </FormButton>
              </div>
            ) : null;
          })()}
    </div>
  );
}
