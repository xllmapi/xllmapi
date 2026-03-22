import { useCallback, useEffect, useState } from "react";
import { apiJson, getApiKey } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge } from "@/components/ui/Badge";

interface ProviderPreset {
  id: string;
  providerType: string;
  name: string;
  label?: string;
  baseUrl: string;
  logicalModel: string;
  realModel: string;
}

interface DiscoveredModel {
  id: string;
  name?: string;
}

interface Offering {
  id: string;
  logicalModel: string;
  realModel: string;
  credentialId: string;
  reviewStatus: string;
  enabled: number | boolean;
  createdAt: string;
}

interface SupplyUsageItem {
  offeringId: string;
  logicalModel: string;
  realModel: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  supplierReward: number;
}

interface SupplyUsage {
  summary: {
    requestCount: number;
    totalTokens: number;
    supplierReward: number;
  };
  items: SupplyUsageItem[];
}

function formatRuntime(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const diffMs = now - created;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diffMs / (1000 * 60));
  return `${mins}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function NetworkPage() {
  const { t } = useLocale();
  const [catalog, setCatalog] = useState<ProviderPreset[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [supplyUsage, setSupplyUsage] = useState<SupplyUsageItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [togglingId, setTogglingId] = useState("");

  // Model discovery state
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");

  const myKey = getApiKey() ?? "";

  const loadData = useCallback(async () => {
    try {
      const [catalogRes, offeringsRes, usageRes] = await Promise.all([
        apiJson<{ data: ProviderPreset[] }>("/v1/provider-catalog"),
        apiJson<{ data: Offering[] }>("/v1/offerings"),
        apiJson<{ data: SupplyUsage }>("/v1/usage/supply").catch(() => ({ data: { summary: { requestCount: 0, totalTokens: 0, supplierReward: 0 }, items: [] } })),
      ]);
      setCatalog(catalogRes.data ?? []);
      setOfferings(offeringsRes.data ?? []);
      setSupplyUsage(usageRes.data?.items ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Group catalog by providerType
  const providers = Array.from(new Set(catalog.map((p) => p.providerType)));
  const providerModels = catalog.filter((p) => p.providerType === selectedProvider);
  const providerName = providerModels[0]?.name?.split(" ")[0] ?? providerModels[0]?.label?.split(" ")[0] ?? selectedProvider;

  // Merge preset models + discovered models into a unified selectable list
  const selectableModels: { id: string; label: string; realModel: string; source: "preset" | "discovered" | "custom" }[] = [];

  // Preset models first
  for (const pm of providerModels) {
    selectableModels.push({ id: `preset:${pm.id}`, label: pm.logicalModel, realModel: pm.realModel, source: "preset" });
  }

  // Then discovered models (exclude ones already in presets)
  if (discoveryDone) {
    const presetRealModels = new Set(providerModels.map((p) => p.realModel));
    for (const dm of discoveredModels) {
      if (!presetRealModels.has(dm.id)) {
        selectableModels.push({ id: `discovered:${dm.id}`, label: dm.id, realModel: dm.id, source: "discovered" });
      }
    }
  }

  const toggleModel = (id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setSelectedProvider("");
    setSelectedModels(new Set());
    setApiKey("");
    setDiscoveredModels([]);
    setDiscoveryDone(false);
    setCustomModelInput("");
  };

  const handleDiscover = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    setDiscovering(true);
    setError("");

    const firstPreset = providerModels[0];
    try {
      const result = await apiJson<{ ok: boolean; data: DiscoveredModel[]; message?: string }>(
        "/v1/provider-models",
        {
          method: "POST",
          body: JSON.stringify({
            providerType: firstPreset?.providerType ?? selectedProvider,
            baseUrl: firstPreset?.baseUrl ?? "",
            apiKey: apiKey.trim(),
          }),
        },
      );
      setDiscoveredModels(result.data ?? []);
      setDiscoveryDone(true);
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setDiscovering(false);
    }
  };

  const addCustomModel = () => {
    const name = customModelInput.trim();
    if (!name) return;
    // Add as discovered model
    setDiscoveredModels((prev) => {
      if (prev.some((m) => m.id === name)) return prev;
      return [...prev, { id: name }];
    });
    setDiscoveryDone(true);
    // Auto-select it
    setSelectedModels((prev) => new Set([...prev, `discovered:${name}`]));
    setCustomModelInput("");
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!selectedProvider || selectedModels.size === 0 || !apiKey.trim()) return;

    // Resolve selected models to {logicalModel, realModel, baseUrl, providerType}
    const modelsToSubmit: { logicalModel: string; realModel: string }[] = [];
    for (const id of selectedModels) {
      const item = selectableModels.find((m) => m.id === id);
      if (item) {
        modelsToSubmit.push({ logicalModel: item.label, realModel: item.realModel });
      }
    }
    if (modelsToSubmit.length === 0) return;

    const firstPreset = providerModels[0];
    setPublishing(true);
    try {
      const credResult = await apiJson<{ data: { id: string } }>(
        "/v1/provider-credentials",
        {
          method: "POST",
          body: JSON.stringify({
            providerId: firstPreset?.id,
            providerType: firstPreset?.providerType ?? selectedProvider,
            baseUrl: firstPreset?.baseUrl ?? "",
            apiKey: apiKey.trim(),
          }),
        },
      );

      for (const model of modelsToSubmit) {
        await apiJson("/v1/offerings", {
          method: "POST",
          body: JSON.stringify({
            logicalModel: model.logicalModel,
            credentialId: credResult.data.id,
            realModel: model.realModel,
          }),
        });
      }

      setSuccess(t("network.submitted"));
      resetForm();
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setPublishing(false);
    }
  };

  const toggleOffering = async (offering: Offering) => {
    const newEnabled = !(offering.enabled === 1 || offering.enabled === true);
    setTogglingId(offering.id);
    try {
      await apiJson(`/v1/offerings/${encodeURIComponent(offering.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: newEnabled }),
      });
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setTogglingId("");
    }
  };

  const getUsageForOffering = (offeringId: string): SupplyUsageItem | undefined => {
    return supplyUsage.find((u) => u.offeringId === offeringId);
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const isEnabled = (o: Offering) => o.enabled === 1 || o.enabled === true;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("network.title")}</h1>

      {/* API Key display */}
      {myKey && (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <p className="text-text-secondary text-xs mb-2">{t("network.apiKey")}</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-sm text-text-primary bg-bg-0/50 rounded-[var(--radius-input)] px-3 py-2 overflow-hidden text-ellipsis">
              {myKey.slice(0, 12)}{"•".repeat(20)}
            </code>
            <CopyButton text={myKey} label={t("network.copy")} copiedLabel={t("network.copied")} />
          </div>
        </div>
      )}

      {/* Submit Provider Key */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("network.submitProvider")}</h2>
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
        <form onSubmit={handlePublish} className="flex flex-col gap-5 max-w-lg">
          {/* Row 1: Select provider */}
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">{t("network.selectProvider")}</label>
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value);
                setSelectedModels(new Set());
                setDiscoveredModels([]);
                setDiscoveryDone(false);
              }}
              className="w-full rounded-[var(--radius-input)] border border-line px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            >
              <option value="">{t("network.chooseProvider")}</option>
              {providers.map((pt) => {
                const sample = catalog.find((p) => p.providerType === pt);
                return (
                  <option key={pt} value={pt}>
                    {sample?.name?.split(" ")[0] ?? sample?.label?.split(" ")[0] ?? pt}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Row 2: API Key */}
          {selectedProvider && (
            <FormInput
              label={t("network.providerKey")}
              type="password"
              placeholder={t("network.providerKeyPlaceholder")}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}

          {/* Row 3: Discover models button */}
          {selectedProvider && apiKey.trim() && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleDiscover()}
                disabled={discovering}
                className="rounded-[var(--radius-btn)] border border-accent/30 text-accent px-4 py-2 text-xs font-medium hover:bg-accent/10 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {discovering ? t("network.discovering") : t("network.discoverModels")}
              </button>
              {discoveryDone && (
                <span className="text-text-tertiary text-xs">
                  {discoveredModels.length} {t("network.discoveredModels").toLowerCase()}
                </span>
              )}
            </div>
          )}

          {/* Row 4: Model selection */}
          {selectedProvider && selectableModels.length > 0 && (
            <div>
              <label className="text-text-secondary text-xs block mb-2">
                {t("network.selectModels")} ({providerName})
              </label>
              <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
                {selectableModels.map((sm) => (
                  <label
                    key={sm.id}
                    className={`flex items-center gap-3 rounded-[var(--radius-input)] border px-4 py-2.5 cursor-pointer transition-colors ${
                      selectedModels.has(sm.id)
                        ? "border-accent/40 bg-accent-bg"
                        : "border-line bg-[rgba(16,21,34,0.4)] hover:border-line-strong"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedModels.has(sm.id)}
                      onChange={() => toggleModel(sm.id)}
                      className="accent-[var(--color-accent)] w-4 h-4"
                    />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="font-mono text-sm text-text-primary truncate">{sm.label}</span>
                      {sm.source === "discovered" && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">API</span>
                      )}
                      {sm.source === "preset" && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-panel-strong text-text-tertiary font-medium">preset</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Row 5: Custom model input */}
          {selectedProvider && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomModel(); } }}
                placeholder={t("network.customModel")}
                className="flex-1 rounded-[var(--radius-input)] border border-line px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors font-mono"
                style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
              />
              <button
                type="button"
                onClick={addCustomModel}
                disabled={!customModelInput.trim()}
                className="rounded-[var(--radius-btn)] border border-line text-text-secondary px-3 py-2 text-xs font-medium hover:border-accent/30 hover:text-accent transition-colors disabled:opacity-40 cursor-pointer"
              >
                {t("network.addCustomModel")}
              </button>
            </div>
          )}

          <FormButton
            type="submit"
            disabled={publishing || !selectedProvider || selectedModels.size === 0 || !apiKey.trim()}
            className="self-start"
          >
            {publishing ? t("network.submitting") : t("network.submit")}
          </FormButton>
        </form>
      </div>

      {/* My Model Nodes */}
      <h2 className="text-base font-semibold mb-4 tracking-tight">{t("network.myNodes")}</h2>
      {offerings.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-8 text-center text-text-tertiary text-sm">
          {t("network.noOfferings")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {offerings.map((o) => {
            const usage = getUsageForOffering(o.id);
            const enabled = isEnabled(o);
            return (
              <div
                key={o.id}
                className={`rounded-[var(--radius-card)] border bg-panel p-5 transition-colors ${
                  enabled ? "border-accent/20" : "border-line opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: model info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="font-mono text-sm font-medium text-text-primary">{o.logicalModel}</span>
                      <Badge>{enabled ? (o.reviewStatus === "approved" ? "running" : o.reviewStatus) : "stopped"}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">
                      <span>{t("network.realModel")}: <span className="font-mono text-text-tertiary">{o.realModel}</span></span>
                      <span>{t("network.created")}: {new Date(o.createdAt).toLocaleDateString()}</span>
                      {enabled && o.createdAt && (
                        <span>{t("network.runtime")}: {formatRuntime(o.createdAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* Right: toggle */}
                  <button
                    onClick={() => void toggleOffering(o)}
                    disabled={togglingId === o.id}
                    className={`shrink-0 rounded-[var(--radius-btn)] px-4 py-1.5 text-xs font-medium cursor-pointer border transition-colors ${
                      enabled
                        ? "border-danger/30 text-danger hover:bg-danger/10 bg-transparent"
                        : "border-accent/30 text-accent hover:bg-accent/10 bg-transparent"
                    } disabled:opacity-50`}
                  >
                    {togglingId === o.id ? "…" : enabled ? t("network.stop") : t("network.start")}
                  </button>
                </div>

                {/* Token usage stats */}
                <div className="mt-3 pt-3 border-t border-line flex gap-6 text-xs">
                  <div>
                    <span className="text-text-tertiary">{t("network.requests")}</span>
                    <span className="ml-1.5 text-text-primary font-medium">{usage?.requestCount ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">{t("network.tokensUsed")}</span>
                    <span className="ml-1.5 text-text-primary font-medium">{formatTokens(usage?.totalTokens ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">In</span>
                    <span className="ml-1.5 text-text-secondary">{formatTokens(usage?.inputTokens ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Out</span>
                    <span className="ml-1.5 text-text-secondary">{formatTokens(usage?.outputTokens ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">{t("network.earned")}</span>
                    <span className="ml-1.5 text-accent font-medium">{(usage?.supplierReward ?? 0).toFixed(4)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    const e = (err as { error: { message: string; code?: string } }).error;
    return e.message;
  }
  return "Something went wrong";
}
