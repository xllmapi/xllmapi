import { useCallback, useEffect, useRef, useState } from "react";
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

function formatTokens(v: number | string): string {
  const n = Number(v) || 0;
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
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
  const [publishStep, setPublishStep] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [togglingId, setTogglingId] = useState("");

  // Model discovery state
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const discoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-model pricing state: modelId → { input, output }
  const [modelPricing, setModelPricing] = useState<Record<string, { input: string; output: string }>>({});
  const [pricingGuidance, setPricingGuidance] = useState<{
    platformMinInput: number;
    platformMaxInput: number;
    platformMinOutput: number;
    platformMaxOutput: number;
    avg7dInputPricePer1k: number | null;
    avg7dOutputPricePer1k: number | null;
  } | null>(null);
  const [guidanceDefaults, setGuidanceDefaults] = useState<Record<string, { input: number; output: number }>>({});

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

  // Unique providers from catalog (group by id)
  const providerMap = new Map<string, ProviderPreset>();
  for (const p of catalog) {
    if (!providerMap.has(p.id)) providerMap.set(p.id, p);
  }
  const providers = Array.from(providerMap.keys());
  const providerModels = catalog.filter((p) => p.id === selectedProvider);
  const firstPreset = providerModels[0];
  const providerLabel = firstPreset?.label ?? firstPreset?.name ?? selectedProvider;

  // Auto-discover models when provider + API key are both set
  const doDiscover = useCallback(async (preset: ProviderPreset, key: string) => {
    setDiscovering(true);
    setDiscoveryFailed(false);
    try {
      const result = await apiJson<{ ok: boolean; data: DiscoveredModel[]; message?: string }>(
        "/v1/provider-models",
        {
          method: "POST",
          body: JSON.stringify({
            providerType: preset.providerType,
            baseUrl: preset.baseUrl,
            apiKey: key,
          }),
        },
      );
      if (result.ok !== false && result.data?.length > 0) {
        setDiscoveredModels(result.data);
        setDiscoveryDone(true);
        setDiscoveryFailed(false);
      } else {
        setDiscoveryFailed(true);
        setDiscoveryDone(true);
      }
    } catch {
      setDiscoveryFailed(true);
      setDiscoveryDone(true);
    } finally {
      setDiscovering(false);
    }
  }, []);

  // Trigger auto-discover with debounce when apiKey changes
  useEffect(() => {
    if (discoverTimerRef.current) clearTimeout(discoverTimerRef.current);
    setDiscoveredModels([]);
    setDiscoveryDone(false);
    setDiscoveryFailed(false);
    setSelectedModels(new Set());

    if (!selectedProvider || !apiKey.trim() || apiKey.trim().length < 8) return;

    const preset = catalog.find((p) => p.id === selectedProvider);
    if (!preset) return;

    discoverTimerRef.current = setTimeout(() => {
      void doDiscover(preset, apiKey.trim());
    }, 600);

    return () => {
      if (discoverTimerRef.current) clearTimeout(discoverTimerRef.current);
    };
  }, [selectedProvider, apiKey, catalog, doDiscover]);

  // Build selectable model list: discovered models first, then preset fallback
  const selectableModels: { id: string; label: string; realModel: string; source: "discovered" | "preset" }[] = [];

  if (discoveryDone && !discoveryFailed && discoveredModels.length > 0) {
    // Show discovered models
    for (const dm of discoveredModels) {
      selectableModels.push({ id: `discovered:${dm.id}`, label: dm.id, realModel: dm.id, source: "discovered" });
    }
  } else {
    // Fallback to presets
    for (const pm of providerModels) {
      selectableModels.push({ id: `preset:${pm.logicalModel}`, label: pm.logicalModel, realModel: pm.realModel, source: "preset" });
    }
  }

  // Fetch pricing guidance when a model is toggled on
  const fetchGuidanceForModel = useCallback((modelLabel: string, modelId: string) => {
    if (guidanceDefaults[modelId]) return;
    apiJson<any>(`/v1/pricing/guidance?logicalModel=${encodeURIComponent(modelLabel)}`)
      .then((res) => {
        setGuidanceDefaults((prev) => ({ ...prev, [modelId]: { input: res.inputPricePer1k ?? 300, output: res.outputPricePer1k ?? 500 } }));
        setModelPricing((prev) => prev[modelId] ? prev : { ...prev, [modelId]: { input: String(res.inputPricePer1k ?? ""), output: String(res.outputPricePer1k ?? "") } });
        if (!pricingGuidance) {
          setPricingGuidance({
            platformMinInput: res.platformMinInput ?? 0,
            platformMaxInput: res.platformMaxInput ?? 0,
            platformMinOutput: res.platformMinOutput ?? 0,
            platformMaxOutput: res.platformMaxOutput ?? 0,
            avg7dInputPricePer1k: res.avg7dInputPricePer1k,
            avg7dOutputPricePer1k: res.avg7dOutputPricePer1k,
          });
        }
      })
      .catch(() => {});
  }, [guidanceDefaults, pricingGuidance]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleModel = (id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        const item = selectableModels.find((m) => m.id === id);
        if (item) fetchGuidanceForModel(item.label, id);
      }
      return next;
    });
  };

  const addCustomModel = () => {
    const name = customModelInput.trim();
    if (!name) return;
    setDiscoveredModels((prev) => {
      if (prev.some((m) => m.id === name)) return prev;
      return [...prev, { id: name }];
    });
    if (!discoveryDone || discoveryFailed) {
      setDiscoveryDone(true);
      setDiscoveryFailed(false);
    }
    setSelectedModels((prev) => new Set([...prev, `discovered:${name}`]));
    setCustomModelInput("");
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!selectedProvider || selectedModels.size === 0 || !apiKey.trim()) return;

    const modelsToSubmit: { logicalModel: string; realModel: string; inputPrice?: number; outputPrice?: number }[] = [];
    for (const id of selectedModels) {
      const item = selectableModels.find((m) => m.id === id);
      if (item) {
        const p = modelPricing[id];
        modelsToSubmit.push({
          logicalModel: item.label,
          realModel: item.realModel,
          inputPrice: p?.input ? Number(p.input) : undefined,
          outputPrice: p?.output ? Number(p.output) : undefined,
        });
      }
    }
    if (modelsToSubmit.length === 0) return;

    setPublishing(true);
    setPublishStep(t("network.step.validating"));
    try {
      let credResult: { data: { id: string } };
      try {
        credResult = await apiJson<{ data: { id: string } }>(
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
      } catch (err: unknown) {
        setError(extractError(err));
        setPublishing(false);
        setPublishStep("");
        return;
      }

      setPublishStep(t("network.step.creating"));
      let created = 0;
      for (const model of modelsToSubmit) {
        try {
          await apiJson("/v1/offerings", {
            method: "POST",
            body: JSON.stringify({
              logicalModel: model.logicalModel,
              credentialId: credResult.data.id,
              realModel: model.realModel,
              ...(model.inputPrice ? { fixedPricePer1kInput: model.inputPrice } : {}),
              ...(model.outputPrice ? { fixedPricePer1kOutput: model.outputPrice } : {}),
            }),
          });
          created++;
        } catch (err: unknown) {
          setError((prev) => prev ? `${prev}\n${model.logicalModel}: ${extractError(err)}` : `${model.logicalModel}: ${extractError(err)}`);
        }
      }

      if (created > 0) {
        setPublishStep(t("network.step.done"));
        setSuccess(`${t("network.submitted")} (${created} ${created === 1 ? "model" : "models"})`);
        setSelectedModels(new Set());
        setApiKey("");
        setDiscoveredModels([]);
        setDiscoveryDone(false);
        setDiscoveryFailed(false);
        setCustomModelInput("");
        setModelPricing({});
        setGuidanceDefaults({});
        setPricingGuidance(null);
        await loadData();
      }
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setPublishing(false);
      setTimeout(() => setPublishStep(""), 3000);
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
                setDiscoveryFailed(false);
                setApiKey("");
              }}
              className="w-full rounded-[var(--radius-input)] border border-line px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            >
              <option value="">{t("network.chooseProvider")}</option>
              {providers.map((providerId) => {
                const sample = providerMap.get(providerId);
                return (
                  <option key={providerId} value={providerId}>
                    {sample?.label ?? sample?.name ?? providerId}
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

          {/* Discovery status indicator */}
          {selectedProvider && apiKey.trim().length >= 8 && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              {discovering && (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  <span>{t("network.discovering")}</span>
                </>
              )}
              {discoveryDone && !discoveryFailed && discoveredModels.length > 0 && (
                <span className="text-success">{discoveredModels.length} {t("network.discoveredModels").toLowerCase()}</span>
              )}
              {discoveryDone && discoveryFailed && (
                <span className="text-text-tertiary">{t("network.noModelsFound")}</span>
              )}
            </div>
          )}

          {/* Row 3: Model selection with per-model pricing */}
          {selectedProvider && selectableModels.length > 0 && !discovering && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-text-secondary text-xs">{t("network.selectModels")} ({providerLabel})</label>
                {pricingGuidance && (pricingGuidance.platformMinInput > 0 || pricingGuidance.avg7dInputPricePer1k != null) && (
                  <span className="text-[10px] text-text-tertiary">
                    {pricingGuidance.platformMinInput > 0 && `最低 ${pricingGuidance.platformMinInput}/${pricingGuidance.platformMinOutput}`}
                    {pricingGuidance.platformMaxInput > 0 && ` · 最高 ${pricingGuidance.platformMaxInput}/${pricingGuidance.platformMaxOutput}`}
                    {pricingGuidance.avg7dInputPricePer1k != null && ` · 7天均价 ${pricingGuidance.avg7dInputPricePer1k}/${pricingGuidance.avg7dOutputPricePer1k}`}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
                {selectableModels.map((sm) => {
                  const checked = selectedModels.has(sm.id);
                  const pricing = modelPricing[sm.id];
                  const defaults = guidanceDefaults[sm.id];
                  return (
                    <div
                      key={sm.id}
                      className={`flex items-center gap-3 rounded-[var(--radius-input)] border px-4 py-2.5 transition-colors ${
                        checked ? "border-accent/40 bg-accent-bg" : "border-line bg-[rgba(16,21,34,0.4)] hover:border-line-strong"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleModel(sm.id)}
                        className="accent-[var(--color-accent)] w-4 h-4 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="font-mono text-sm text-text-primary truncate">{sm.label}</span>
                        {sm.source === "discovered" && (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">API</span>
                        )}
                      </div>
                      {/* Per-model pricing inputs (shown when checked) */}
                      {checked && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-text-tertiary">xt/1K:</span>
                          <input
                            type="number"
                            value={pricing?.input ?? ""}
                            onChange={(e) => setModelPricing((prev) => ({ ...prev, [sm.id]: { ...prev[sm.id]!, input: e.target.value, output: prev[sm.id]?.output ?? "" } }))}
                            placeholder={String(defaults?.input ?? "")}
                            className="w-16 rounded border border-line px-1.5 py-1 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent"
                            style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="text-[10px] text-text-tertiary">/</span>
                          <input
                            type="number"
                            value={pricing?.output ?? ""}
                            onChange={(e) => setModelPricing((prev) => ({ ...prev, [sm.id]: { input: prev[sm.id]?.input ?? "", output: e.target.value } }))}
                            placeholder={String(defaults?.output ?? "")}
                            className="w-16 rounded border border-line px-1.5 py-1 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent"
                            style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Row 4: Custom model input */}
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

          <div className="flex items-center gap-3">
            <FormButton
              type="submit"
              disabled={publishing || !selectedProvider || selectedModels.size === 0 || !apiKey.trim()}
              className="shrink-0"
            >
              {publishing ? t("network.submitting") : t("network.submit")}
            </FormButton>
            {publishStep && (
              <span className={`text-xs font-medium ${publishStep === t("network.step.done") ? "text-success" : "text-text-secondary"}`}>
                {publishStep === t("network.step.done") ? (
                  <>{publishStep}</>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                    {publishStep}
                  </span>
                )}
              </span>
            )}
          </div>
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
                    <span className="ml-1.5 text-accent font-medium">{Number(usage?.supplierReward ?? 0).toFixed(4)}</span>
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
