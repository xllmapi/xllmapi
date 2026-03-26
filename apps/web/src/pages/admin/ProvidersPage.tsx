import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

/* ---------- types ---------- */

interface ProviderInfo {
  providerType: string;
  offeringCount: number;
  requestCount: number;
}

interface PresetModel {
  logicalModel: string;
  realModel: string;
  contextLength?: number;
  maxOutputTokens?: number;
}

interface ProviderPreset {
  id: string;
  label: string;
  providerType: string;
  baseUrl: string;
  anthropicBaseUrl: string | null;
  models: PresetModel[];
  enabled: boolean;
  sortOrder: number;
}

type Tab = "presets" | "status";

/* ---------- helpers ---------- */

const EMPTY_PRESET: ProviderPreset = {
  id: "",
  label: "",
  providerType: "openai_compatible",
  baseUrl: "",
  anthropicBaseUrl: null,
  models: [],
  enabled: true,
  sortOrder: 0,
};

function formatProviderType(t: (k: string) => string, type: string): string {
  switch (type) {
    case "openai_compatible":
      return t("admin.providers.formatBoth");
    case "openai":
      return t("admin.providers.formatOpenai");
    case "anthropic":
      return t("admin.providers.formatAnthropic");
    default:
      return type;
  }
}

/* ---------- Presets Tab ---------- */

function PresetsTab() {
  const { t } = useLocale();
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProviderPreset | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [modelsText, setModelsText] = useState("");

  const loadPresets = useCallback(async () => {
    try {
      const res = await apiJson<{ data: ProviderPreset[] }>("/v1/admin/provider-presets");
      setPresets(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const openCreate = () => {
    setEditing({ ...EMPTY_PRESET });
    setModelsText("[]");
    setIsNew(true);
    setMessage(null);
  };

  const openEdit = (preset: ProviderPreset) => {
    setEditing({ ...preset });
    setModelsText(JSON.stringify(preset.models, null, 2));
    setIsNew(false);
    setMessage(null);
  };

  const closeForm = () => {
    setEditing(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      let models: PresetModel[];
      try {
        models = JSON.parse(modelsText);
      } catch {
        setMessage({ type: "error", text: "Invalid JSON for models" });
        setSaving(false);
        return;
      }
      const body = { ...editing, models };
      if (isNew) {
        await apiJson("/v1/admin/provider-presets", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        await apiJson(`/v1/admin/provider-presets/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      }
      setMessage({ type: "success", text: t("admin.settings.saved") });
      closeForm();
      await loadPresets();
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("admin.providers.confirmDelete"))) return;
    try {
      await apiJson(`/v1/admin/provider-presets/${id}`, { method: "DELETE" });
      await loadPresets();
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  /* ---- editing form ---- */
  if (editing) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <FormInput
            label={t("admin.providers.presetId")}
            value={editing.id}
            onChange={(e) => setEditing({ ...editing, id: e.target.value })}
            readOnly={!isNew}
            className={!isNew ? "opacity-60" : ""}
          />
          <FormInput
            label={t("admin.providers.presetLabel")}
            value={editing.label}
            onChange={(e) => setEditing({ ...editing, label: e.target.value })}
          />
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">
              {t("admin.providers.presetType")}
            </label>
            <select
              value={editing.providerType}
              onChange={(e) => setEditing({ ...editing, providerType: e.target.value })}
              className="w-full rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            >
              <option value="openai_compatible">{t("admin.providers.formatBoth")}</option>
              <option value="openai">{t("admin.providers.formatOpenai")}</option>
              <option value="anthropic">{t("admin.providers.formatAnthropic")}</option>
            </select>
          </div>
          <FormInput
            label={t("admin.providers.presetSortOrder")}
            type="number"
            value={String(editing.sortOrder)}
            onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })}
          />
          <FormInput
            label={t("admin.providers.presetBaseUrl")}
            value={editing.baseUrl}
            onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
          />
          <FormInput
            label={t("admin.providers.presetAnthropicUrl")}
            value={editing.anthropicBaseUrl ?? ""}
            onChange={(e) =>
              setEditing({ ...editing, anthropicBaseUrl: e.target.value || null })
            }
          />
        </div>

        {/* enabled toggle */}
        <div className="flex items-center gap-2 mb-4">
          <label className="text-text-secondary text-xs">{t("admin.providers.presetEnabled")}</label>
          <button
            type="button"
            onClick={() => setEditing({ ...editing, enabled: !editing.enabled })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
              editing.enabled ? "bg-accent" : "bg-line"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                editing.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
        </div>

        {/* models JSON */}
        <div className="mb-4">
          <label className="text-text-secondary text-xs block mb-1.5">
            {t("admin.providers.presetModels")} (JSON)
          </label>
          <textarea
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            rows={8}
            className="w-full rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors font-mono"
          />
        </div>

        <div className="flex gap-3">
          <FormButton onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("common.loading") : t("admin.providers.presetSave")}
          </FormButton>
          <FormButton variant="ghost" onClick={closeForm}>
            {t("admin.providers.presetCancel")}
          </FormButton>
        </div>
      </div>
    );
  }

  /* ---- presets table ---- */
  const columns: Column<ProviderPreset>[] = [
    {
      key: "id",
      header: t("admin.providers.presetId"),
      render: (p) => <span className="font-mono text-xs">{p.id}</span>,
    },
    {
      key: "label",
      header: t("admin.providers.presetLabel"),
      render: (p) => <span className="font-medium">{p.label}</span>,
    },
    {
      key: "providerType",
      header: t("admin.providers.presetType"),
      render: (p) => (
        <span className="text-xs text-text-secondary">{formatProviderType(t, p.providerType)}</span>
      ),
    },
    {
      key: "baseUrl",
      header: t("admin.providers.presetBaseUrl"),
      render: (p) => <span className="text-xs text-text-secondary truncate max-w-[200px] inline-block">{p.baseUrl}</span>,
    },
    {
      key: "models",
      header: t("admin.providers.presetModelCount"),
      align: "right",
      render: (p) => formatNumber(p.models.length),
    },
    {
      key: "enabled",
      header: t("admin.providers.presetEnabled"),
      render: (p) => (
        <span
          className={`inline-block w-2 h-2 rounded-full ${p.enabled ? "bg-success" : "bg-text-tertiary"}`}
        />
      ),
    },
    {
      key: "actions",
      header: t("common.actions"),
      render: (p) => (
        <div className="flex gap-2">
          <button
            onClick={() => openEdit(p)}
            className="text-xs text-accent hover:underline cursor-pointer"
          >
            {t("admin.providers.editPreset")}
          </button>
          <button
            onClick={() => void handleDelete(p.id)}
            className="text-xs text-danger hover:underline cursor-pointer"
          >
            {t("admin.providers.deletePreset")}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
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
      <div className="mb-4">
        <FormButton onClick={openCreate}>{t("admin.providers.addPreset")}</FormButton>
      </div>
      <DataTable columns={columns} data={presets} rowKey={(p) => p.id} emptyText={t("common.empty")} />
    </div>
  );
}

/* ---------- Status Tab (original content) ---------- */

function StatusTab() {
  const { t } = useLocale();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ data: ProviderInfo[] }>("/v1/admin/providers")
      .then((r) => setProviders(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const columns: Column<ProviderInfo>[] = [
    {
      key: "providerType",
      header: t("admin.providers.type"),
      render: (p) => <span className="font-medium">{p.providerType}</span>,
    },
    {
      key: "status",
      header: t("admin.providers.status"),
      render: (p) => (
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              p.requestCount > 0 ? "bg-success" : "bg-text-tertiary"
            }`}
          />
          {p.requestCount > 0 ? t("admin.providers.active") : t("admin.providers.idle")}
        </span>
      ),
    },
    {
      key: "offeringCount",
      header: t("admin.providers.offerings"),
      align: "right",
      render: (p) => formatNumber(p.offeringCount),
    },
    {
      key: "requestCount",
      header: t("admin.usage.requests"),
      align: "right",
      render: (p) => formatNumber(p.requestCount),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={providers}
      rowKey={(p) => p.providerType}
      emptyText={t("common.empty")}
    />
  );
}

/* ---------- Main Page ---------- */

export function ProvidersPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("presets");

  const tabs: { key: Tab; label: string }[] = [
    { key: "presets", label: t("admin.providers.tabs.presets") },
    { key: "status", label: t("admin.providers.tabs.status") },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.providers.title")}</h1>

      {/* tab bar */}
      <div className="flex gap-1 mb-6 border-b border-line">
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors -mb-px ${
              tab === item.key
                ? "text-accent border-b-2 border-accent"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "presets" && <PresetsTab />}
      {tab === "status" && <StatusTab />}
    </div>
  );
}
