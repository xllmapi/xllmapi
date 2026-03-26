import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

type BannerType = "info" | "warning" | "error";

export function AdminBannerPage() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [content, setContent] = useState("");
  const [type, setType] = useState<BannerType>("info");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ data: { key: string; value: string }[] }>("/v1/admin/config")
      .then((res) => {
        const lookup = new Map(res.data.map((r) => [r.key, r.value]));
        setEnabled(lookup.get("site_banner_enabled") === "true");
        setContent(lookup.get("site_banner_content") ?? "");
        setType((lookup.get("site_banner_type") as BannerType) ?? "info");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        apiJson("/v1/admin/config", {
          method: "PUT",
          body: JSON.stringify({ key: "site_banner_enabled", value: enabled ? "true" : "false" }),
        }),
        apiJson("/v1/admin/config", {
          method: "PUT",
          body: JSON.stringify({ key: "site_banner_content", value: content }),
        }),
        apiJson("/v1/admin/config", {
          method: "PUT",
          body: JSON.stringify({ key: "site_banner_type", value: type }),
        }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const typeStyles: Record<BannerType, string> = {
    info: "bg-accent/10 border-accent/30 text-accent",
    warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-600",
    error: "bg-danger/10 border-danger/30 text-danger",
  };

  if (loading) {
    return <div className="text-text-tertiary text-sm py-8">{t("common.loading")}</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary mb-6">{t("admin.banner.title")}</h2>

      <div className="space-y-5 max-w-lg">
        {/* Toggle */}
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-text-primary">{t("admin.banner.enabled")}</label>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border-none ${
              enabled ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Content */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">{t("admin.banner.content")}</label>
          <textarea
            className="w-full rounded-[var(--radius-input)] border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent resize-y min-h-[60px]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">{t("admin.banner.type")}</label>
          <select
            className="w-full rounded-[var(--radius-input)] border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            value={type}
            onChange={(e) => setType(e.target.value as BannerType)}
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        {/* Preview */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">{t("admin.banner.preview")}</label>
          {enabled && content ? (
            <div
              className={`border rounded-[var(--radius-input)] px-4 py-2 text-xs text-center ${typeStyles[type]}`}
            >
              {content}
            </div>
          ) : (
            <div className="border border-border rounded-[var(--radius-input)] px-4 py-2 text-xs text-text-tertiary text-center">
              —
            </div>
          )}
        </div>

        {/* Save */}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-[var(--radius-input)] bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer border-none transition-colors"
        >
          {saving ? t("common.loading") : saved ? t("admin.banner.saved") : t("admin.banner.save")}
        </button>
      </div>
    </div>
  );
}
