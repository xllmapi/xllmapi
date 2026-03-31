import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber, formatProviderType } from "@/lib/utils";
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
  customHeaders: unknown | null;
  thirdParty: boolean;
  thirdPartyLabel: string | null;
  trustLevel: string;
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
  customHeaders: null,
  thirdParty: false,
  thirdPartyLabel: null,
  trustLevel: "high",
};

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
  const [customHeadersText, setCustomHeadersText] = useState("");

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
    setCustomHeadersText("");
    setIsNew(true);
    setMessage(null);
  };

  const openEdit = (preset: ProviderPreset) => {
    setEditing({ ...preset });
    setModelsText(JSON.stringify(preset.models, null, 2));
    setCustomHeadersText(preset.customHeaders ? JSON.stringify(preset.customHeaders, null, 2) : "");
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
      let customHeaders: unknown = null;
      if (customHeadersText.trim()) {
        try {
          customHeaders = JSON.parse(customHeadersText);
        } catch {
          setMessage({ type: "error", text: "Invalid JSON for custom headers" });
          setSaving(false);
          return;
        }
      }
      const body = { ...editing, models, customHeaders };
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

        {/* third-party label config */}
        <div className="border-t border-line pt-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <label className="text-text-secondary text-xs">{t("admin.providers.thirdParty")}</label>
            <button
              type="button"
              onClick={() => setEditing({ ...editing, thirdParty: !editing.thirdParty })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                editing.thirdParty ? "bg-orange-500" : "bg-line"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  editing.thirdParty ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
          </div>
          {editing.thirdParty && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormInput
                label={t("admin.providers.thirdPartyLabel")}
                placeholder={t("admin.providers.thirdPartyLabelHint")}
                value={editing.thirdPartyLabel ?? ""}
                onChange={(e) => setEditing({ ...editing, thirdPartyLabel: e.target.value || null })}
              />
              <div>
                <label className="text-text-secondary text-xs block mb-1.5">{t("admin.providers.trustLevel")}</label>
                <div className="flex items-center gap-3">
                  {(["high", "medium", "low"] as const).map((level) => {
                    const colors = { high: "text-teal-400 border-teal-400/40", medium: "text-orange-400 border-orange-400/40", low: "text-red-400 border-red-400/40" };
                    const labels = { high: t("admin.providers.trustHigh"), medium: t("admin.providers.trustMedium"), low: t("admin.providers.trustLow") };
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setEditing({ ...editing, trustLevel: level })}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium border cursor-pointer transition-colors ${
                          editing.trustLevel === level
                            ? `${colors[level]} bg-${level === "high" ? "teal" : level === "medium" ? "orange" : "red"}-500/10`
                            : "border-line text-text-tertiary"
                        }`}
                      >
                        {labels[level]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
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

        {/* custom headers JSON */}
        <div className="mb-4">
          <label className="text-text-secondary text-xs block mb-1.5">
            Custom Headers (JSON)
          </label>
          <textarea
            value={customHeadersText}
            onChange={(e) => setCustomHeadersText(e.target.value)}
            rows={4}
            placeholder='{"headers":{"user-agent":{"value":"claude-code/1.0","mode":"fallback"}},"passthrough":true}'
            className="w-full rounded-[var(--radius-input)] border border-line bg-[rgba(16,21,34,0.6)] px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors font-mono"
          />
          <p className="text-text-tertiary text-[10px] mt-1">mode: &quot;force&quot; | &quot;fallback&quot;. Placeholder: $CLIENT_USER_AGENT</p>
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
        <span className="text-xs text-text-secondary">{formatProviderType(p.providerType)}</span>
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
      render: (p) => <span className="font-medium">{formatProviderType(p.providerType)}</span>,
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

/* ---------- Audit Log ---------- */

interface AuditEntry {
  id: number;
  action: string;
  targetId: string;
  payload: { label?: string; providerType?: string; baseUrl?: string };
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

const ACTION_LABELS: Record<string, { zh: string; color: string }> = {
  create: { zh: "新增", color: "text-emerald-400" },
  update: { zh: "修改", color: "text-amber-300" },
  delete: { zh: "删除", color: "text-red-400" },
};

function PresetAuditLog() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ data: AuditEntry[] }>("/v1/admin/provider-presets/audit-log?limit=20")
      .then((r) => setLogs(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || logs.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold mb-3 text-text-secondary">变更记录</h2>
      <div className="rounded-[var(--radius-card)] border border-line bg-panel overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-[rgba(16,21,34,0.5)]">
              <th className="px-4 py-2.5 text-left font-medium text-text-secondary">时间</th>
              <th className="px-4 py-2.5 text-left font-medium text-text-secondary">操作</th>
              <th className="px-4 py-2.5 text-left font-medium text-text-secondary">供应商</th>
              <th className="px-4 py-2.5 text-left font-medium text-text-secondary">详情</th>
              <th className="px-4 py-2.5 text-left font-medium text-text-secondary">操作人</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const a = ACTION_LABELS[log.action] ?? { zh: log.action, color: "text-text-secondary" };
              return (
                <tr key={log.id} className="border-b border-line/50 last:border-b-0">
                  <td className="px-4 py-2.5 text-text-tertiary whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className={`px-4 py-2.5 font-medium ${a.color}`}>{a.zh}</td>
                  <td className="px-4 py-2.5 font-mono text-text-primary">{log.targetId}</td>
                  <td className="px-4 py-2.5 text-text-secondary">
                    {log.payload?.label && <span>{log.payload.label}</span>}
                    {log.payload?.baseUrl && <span className="ml-2 text-text-tertiary">{log.payload.baseUrl}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">{log.actorName || log.actorEmail || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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

      {/* Audit log */}
      <PresetAuditLog />
    </div>
  );
}
