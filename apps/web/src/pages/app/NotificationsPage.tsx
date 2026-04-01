import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { useCachedFetch } from "@/hooks/useCachedFetch";

interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  created_at: string;
  isRead: boolean;
}

export function NotificationsPage() {
  const { t } = useLocale();
  const { data: notifData } = useCachedFetch<{ data: Notification[] }>("/v1/notifications");
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Sync fetched data into local state for optimistic updates
  useEffect(() => {
    if (notifData?.data) setNotifications(notifData.data);
  }, [notifData]);

  const markRead = async (id: string) => {
    await apiJson(`/v1/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(() => {});
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    window.dispatchEvent(new Event("notifications-changed"));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("notifications.title")}</h1>
        {notifications.some((n) => !n.isRead) && (
          <button
            onClick={async () => {
              await Promise.all(notifications.filter((n) => !n.isRead).map((n) => apiJson(`/v1/notifications/${encodeURIComponent(n.id)}/read`, { method: "POST" }).catch(() => {})));
              setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
              window.dispatchEvent(new Event("notifications-changed"));
            }}
            className="text-xs text-text-tertiary hover:text-accent cursor-pointer bg-transparent border border-line rounded-[var(--radius-btn)] px-3 py-1.5 transition-colors"
          >
            {t("notifications.markAllRead")}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-12 text-center text-text-tertiary text-sm">
          {t("notifications.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-[var(--radius-card)] border bg-panel p-4 transition-colors ${
                n.isRead ? "border-line opacity-60" : "border-accent/20"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
                    <span className="text-sm font-medium text-text-primary">{n.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      n.type === "announcement" ? "bg-accent/10 text-accent" :
                      n.type === "system" ? "bg-amber-400/10 text-amber-400" :
                      "bg-panel-strong text-text-tertiary"
                    }`}>
                      {n.type === "announcement" ? t("notifications.announcement") :
                       n.type === "system" ? t("notifications.system") :
                       t("notifications.personal")}
                    </span>
                  </div>
                  {n.content && (
                    <p className="text-xs text-text-secondary leading-relaxed">{n.content}</p>
                  )}
                  <span className="text-[10px] text-text-tertiary mt-1 block">
                    {n.created_at?.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                {!n.isRead && (
                  <button
                    onClick={() => void markRead(n.id)}
                    className="text-[10px] text-text-tertiary hover:text-accent cursor-pointer bg-transparent border border-line rounded px-2 py-1 shrink-0 transition-colors"
                  >
                    {t("notifications.markRead")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
