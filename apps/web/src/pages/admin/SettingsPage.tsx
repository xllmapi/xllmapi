import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

interface ConfigItem {
  key: string;
  value: string;
  updated_at: string;
}

const CONFIG_GROUPS: Record<string, string[]> = {
  economy: [
    "initial_token_credit",
    "supplier_reward_rate",
    "chat_rate_limit_per_minute",
    "default_invitation_quota",
    "invitation_enabled",
    "max_api_keys_per_user",
  ],
  pricing: [
    "min_input_price",
    "max_input_price",
    "min_output_price",
    "max_output_price",
  ],
  welcome: [
    "welcome_message_enabled",
    "welcome_message_content",
  ],
  nodeDefaults: [
    "default_max_concurrency",
    "default_daily_token_limit",
    "default_input_price_per_1k",
    "default_output_price_per_1k",
    "default_cache_read_discount",
  ],
  proxy: [
    "default_proxy_user_agent",
  ],
};

export function SettingsPage() {
  const { t } = useLocale();
  const { data: raw, refetch } = useCachedFetch<{ data: ConfigItem[] }>("/v1/admin/config");
  const configs = raw?.data ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (configs.length > 0 && !synced) {
      const map: Record<string, string> = {};
      for (const c of configs) {
        map[c.key] = c.value;
      }
      setValues(map);
      setOriginal(map);
      setSynced(true);
    }
  }, [configs, synced]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const changed = Object.entries(values).filter(([k, v]) => original[k] !== v);
      for (const [key, value] of changed) {
        await apiJson("/v1/admin/config", {
          method: "PUT",
          body: JSON.stringify({ key, value }),
        });
      }
      setMessage({ type: "success", text: t("admin.settings.saved") });
      setSynced(false);
      await refetch();
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setSaving(false);
    }
  };

  const knownKeys = Object.values(CONFIG_GROUPS).flat();
  const otherConfigs = configs.filter((c) => !knownKeys.includes(c.key));

  const renderGroup = (title: string, keys: string[]) => (
    <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-6">
      <h2 className="text-base font-semibold mb-4 tracking-tight">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {keys.map((key) => (
          <FormInput
            key={key}
            label={key}
            value={values[key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.settings.title")}</h1>

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

      {renderGroup(t("admin.settings.economy"), CONFIG_GROUPS.economy!)}
      {renderGroup(t("admin.settings.pricing"), CONFIG_GROUPS.pricing!)}
      {renderGroup(t("admin.settings.nodeDefaults"), CONFIG_GROUPS.nodeDefaults!)}
      {renderGroup(t("admin.settings.proxy"), CONFIG_GROUPS.proxy!)}

      {otherConfigs.length > 0 &&
        renderGroup(
          t("admin.settings.other"),
          otherConfigs.map((c) => c.key),
        )}

      <FormButton onClick={() => void handleSave()} disabled={saving} className="mt-2">
        {saving ? t("common.loading") : t("admin.settings.save")}
      </FormButton>
    </div>
  );
}
