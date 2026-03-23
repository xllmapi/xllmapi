import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, getApiKey } from "@/lib/api";
import { formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { Link } from "react-router-dom";
import { invalidateUserModels } from "@/hooks/useUserModels";

// ── Types ────────────────────────────────────────────────────────

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
  executionMode?: string;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  dailyTokenLimit?: number;
  maxConcurrency?: number;
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

interface NodeToken {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  token?: string;
}

interface ConnectedNode {
  id: string;
  tokenId: string;
  status: string;
  lastHeartbeat: string;
  ip: string;
  modelsCount: number;
}

interface PoolEntry {
  offeringId: string;
  logicalModel: string;
  realModel?: string;
  name?: string;
  ownerDisplayName?: string;
  ownerHandle?: string;
  executionMode?: string;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  dailyTokenLimit?: number;
  maxConcurrency?: number;
  enabled?: boolean;
  reviewStatus?: string;
  paused?: boolean;
  joinedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────

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

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    const e = (err as { error: { message: string; code?: string } }).error;
    return e.message;
  }
  return "Something went wrong";
}

// ── Grouping helpers ─────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

type OfferingStatus = "running" | "paused" | "offline" | "notJoined" | "pendingReview" | "stopped";

const statusConfig: Record<OfferingStatus, { icon: string; key: string }> = {
  running: { icon: "\u{1F7E2}", key: "modelsMgmt.status.running" },
  paused: { icon: "\u23F8\uFE0F", key: "modelsMgmt.status.paused" },
  offline: { icon: "\u26AB", key: "modelsMgmt.status.offline" },
  notJoined: { icon: "\u{1F4CE}", key: "modelsMgmt.status.notJoined" },
  pendingReview: { icon: "\u{1F7E1}", key: "modelsMgmt.status.pendingReview" },
  stopped: { icon: "\u2B1C", key: "modelsMgmt.status.stopped" },
};

function getOfferingStatus(
  o: Offering,
  nodes: ConnectedNode[],
): OfferingStatus {
  const enabled = o.enabled === 1 || o.enabled === true;
  const isPlatform = o.executionMode === "platform" || !o.executionMode || o.executionMode === "key";
  const hasOnlineNode = nodes.some((n) => n.status === "online");

  if (!enabled) return "stopped";
  if (o.reviewStatus === "pending") return "pendingReview";
  if (o.reviewStatus !== "approved") return "stopped";

  // enabled + approved
  if (isPlatform) return "running";
  // local node mode
  if (hasOnlineNode) return "running";
  return "offline";
}

function isOfferingActive(o: Offering, nodes: ConnectedNode[]): boolean {
  const enabled = o.enabled === 1 || o.enabled === true;
  const isPlatform = o.executionMode === "platform" || !o.executionMode || o.executionMode === "key";
  const hasOnlineNode = nodes.some((n) => n.status === "online");
  return enabled && o.reviewStatus === "approved" && (isPlatform || hasOnlineNode);
}

function isPoolEntryActive(entry: PoolEntry): boolean {
  return !entry.paused && (entry.enabled !== false) && (entry.reviewStatus === "approved" || !entry.reviewStatus);
}

// ── Main component ──────────────────────────────────────────────

export function ModelsManagePage() {
  const { t } = useLocale();
  const isProvided = window.location.pathname.includes("/models/provided");
  const title = isProvided ? t("sidebar.provided") : t("sidebar.connected");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{title}</h1>
      {isProvided ? <ProvidingTab /> : <UsingTab />}
    </div>
  );
}

// ── Tab 1: Using ────────────────────────────────────────────────

function PoolCard({
  entry,
  isActive,
  expanded,
  onToggleExpand,
  leavingId,
  handleLeavePool,
  togglingPauseId,
  handleTogglePause,
  t,
}: {
  entry: PoolEntry;
  isActive: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  leavingId: string;
  handleLeavePool: (id: string) => Promise<void>;
  togglingPauseId: string;
  handleTogglePause: (id: string, paused: boolean) => Promise<void>;
  t: (key: string) => string;
}) {
  const displayName = entry.name || entry.logicalModel;
  const inputPrice = entry.fixedPricePer1kInput ?? 0;
  const outputPrice = entry.fixedPricePer1kOutput ?? 0;
  const isPlatform = entry.executionMode === "platform" || !entry.executionMode || entry.executionMode === "key";
  const isVerified = isPlatform && entry.reviewStatus === "approved";

  return (
    <div
      className={`rounded-[var(--radius-card)] border bg-panel transition-colors cursor-pointer ${
        !isActive ? "border-line opacity-60" : "border-accent/20"
      }`}
      onClick={onToggleExpand}
    >
      {/* Collapsed single-line row */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 min-w-0">
        <span className="font-mono font-medium text-sm text-text-primary truncate shrink-0">{displayName}</span>

        {/* Status badge */}
        {entry.enabled !== false && entry.reviewStatus === "approved" ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 font-medium text-emerald-400 shrink-0">
            {"\uD83D\uDFE2"} {t("modelsMgmt.status.running")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-panel border border-line font-medium text-text-secondary shrink-0">
            {"\u26AB"} {t("modelsMgmt.status.offline")}
          </span>
        )}

        {/* Type badge */}
        {isPlatform ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium shrink-0">{"\u2601\uFE0F"} {t("modelsMgmt.platformHosted")}</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-medium shrink-0">{"\uD83D\uDDA5\uFE0F"} {t("modelsMgmt.distributed")}</span>
        )}

        {/* Verification badge */}
        {isVerified && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium shrink-0">{"\u2705"} {t("modelsMgmt.verified")}</span>
        )}

        {/* Supplier name */}
        <span className="text-xs text-text-secondary truncate">{entry.ownerDisplayName || entry.ownerHandle || "-"}</span>

        {/* Price */}
        <span className="font-mono text-xs text-text-tertiary shrink-0">{formatTokens(inputPrice)}/{formatTokens(outputPrice)}</span>

        {/* Buttons — ml-auto, stop propagation */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {isActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); void handleTogglePause(entry.offeringId, false); }}
              disabled={togglingPauseId === entry.offeringId}
              className="rounded-[var(--radius-btn)] px-3 py-1 text-xs font-medium cursor-pointer border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 bg-transparent transition-colors disabled:opacity-50"
            >
              {togglingPauseId === entry.offeringId ? "..." : t("modelsMgmt.disconnect")}
            </button>
          ) : (
            <>
              {entry.enabled !== false && entry.reviewStatus === "approved" && (
                <button
                  onClick={(e) => { e.stopPropagation(); void handleTogglePause(entry.offeringId, true); }}
                  disabled={togglingPauseId === entry.offeringId}
                  className="rounded-[var(--radius-btn)] px-3 py-1 text-xs font-medium cursor-pointer border border-accent/30 text-accent hover:bg-accent/10 bg-transparent transition-colors disabled:opacity-50"
                >
                  {togglingPauseId === entry.offeringId ? "..." : t("modelsMgmt.connect")}
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); void handleLeavePool(entry.offeringId); }}
                disabled={leavingId === entry.offeringId}
                className="rounded-[var(--radius-btn)] px-3 py-1 text-xs font-medium cursor-pointer border border-danger/30 text-danger hover:bg-danger/10 bg-transparent transition-colors disabled:opacity-50"
              >
                {leavingId === entry.offeringId ? "..." : t("modelsMgmt.delete")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-line px-4 py-3 text-xs text-text-secondary flex flex-col gap-1.5">
          {/* Line 1: Supplier + uptime + join date */}
          <div className="flex flex-wrap gap-x-4">
            <span>
              {t("modelsMgmt.supplier")}:{" "}
              {entry.ownerHandle ? (
                <Link
                  to={`/u/${entry.ownerHandle}`}
                  className="text-accent hover:text-accent/80 no-underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {entry.ownerDisplayName || entry.ownerHandle}
                </Link>
              ) : (
                <span className="text-text-tertiary">{entry.ownerDisplayName || "-"}</span>
              )}
              {entry.ownerHandle && <span className="text-text-tertiary ml-1">(@{entry.ownerHandle})</span>}
            </span>
            <span>{t("modelsMgmt.uptime")}: {formatRuntime(entry.joinedAt)}</span>
            <span>{t("modelsMgmt.joinDate")}: {new Date(entry.joinedAt).toLocaleDateString()}</span>
          </div>
          {/* Line 2: Price spelled out */}
          <div>
            {t("modelsMgmt.perKTokens")}: {t("modelsMgmt.xtokensIn")} {formatTokens(inputPrice)} {t("modelsMgmt.xtokens")} / {t("modelsMgmt.xtokensOut")} {formatTokens(outputPrice)} {t("modelsMgmt.xtokens")}
          </div>
          {/* Line 3: Limits */}
          <div>
            {t("modelsMgmt.dailyLimit")}: {entry.dailyTokenLimit ? `${formatTokens(entry.dailyTokenLimit)} tokens` : "-"} · {t("modelsMgmt.maxConc")}: {entry.maxConcurrency ?? "-"}
          </div>
        </div>
      )}
    </div>
  );
}

function UsingTab() {
  const { t } = useLocale();
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leavingId, setLeavingId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const poolRes = await apiJson<{ data: PoolEntry[] }>("/v1/me/connection-pool").catch(() => ({ data: [] as PoolEntry[] }));
      const entries = poolRes.data ?? [];
      setPool(entries);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleLeavePool = async (offeringId: string) => {
    setLeavingId(offeringId);
    setError("");
    try {
      await apiJson(`/v1/me/connection-pool/${encodeURIComponent(offeringId)}`, { method: "DELETE" });
      invalidateUserModels();
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLeavingId("");
    }
  };

  const [togglingPauseId, setTogglingPauseId] = useState("");
  const handleTogglePause = async (offeringId: string, currentlyPaused: boolean) => {
    setTogglingPauseId(offeringId);
    setError("");
    try {
      await apiJson(`/v1/me/connection-pool/${encodeURIComponent(offeringId)}`, {
        method: "PATCH",
        body: JSON.stringify({ paused: !currentlyPaused }),
      });
      invalidateUserModels();
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setTogglingPauseId("");
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const active = pool.filter(isPoolEntryActive);
  const inactive = pool.filter((e) => !isPoolEntryActive(e));

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Link to model network — always visible at top */}
      <div className="mb-4">
        <Link
          to="/mnetwork"
          className="text-sm text-accent hover:text-accent/80 transition-colors no-underline"
        >
          {t("modelsMgmt.goToMNetwork")} →
        </Link>
      </div>

      {pool.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 text-center mb-6">
          <p className="text-text-tertiary text-sm">{t("modelsMgmt.emptyUsageList")}</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="mb-6">
              <h3 className="text-sm font-semibold text-text-primary mb-3">
                {t("modelsMgmt.connected")} ({active.length})
              </h3>
              <div className="flex flex-col gap-2">
                {active.map((entry) => (
                  <PoolCard
                    key={entry.offeringId}
                    entry={entry}
                    isActive={true}
                    expanded={expandedId === entry.offeringId}
                    onToggleExpand={() => setExpandedId(expandedId === entry.offeringId ? null : entry.offeringId)}
                    leavingId={leavingId}
                    handleLeavePool={handleLeavePool}
                    togglingPauseId={togglingPauseId}
                    handleTogglePause={handleTogglePause}
                    t={t}
                  />
                ))}
              </div>
            </section>
          )}

          {inactive.length > 0 && (
            <section className="mb-6">
              <h3 className="text-sm font-semibold text-text-secondary mb-3">
                {t("modelsMgmt.history")} ({inactive.length})
              </h3>
              <div className="flex flex-col gap-2">
                {inactive.map((entry) => (
                  <PoolCard
                    key={entry.offeringId}
                    entry={entry}
                    isActive={false}
                    expanded={expandedId === entry.offeringId}
                    onToggleExpand={() => setExpandedId(expandedId === entry.offeringId ? null : entry.offeringId)}
                    leavingId={leavingId}
                    handleLeavePool={handleLeavePool}
                    togglingPauseId={togglingPauseId}
                    handleTogglePause={handleTogglePause}
                    t={t}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab 2: Providing ────────────────────────────────────────────

// ── Config Modal ─────────────────────────────────────────────────

function ConfigModal({
  offering,
  onClose,
  onSave,
  t,
}: {
  offering: Offering;
  onClose: () => void;
  onSave: (data: { fixedPricePer1kInput: number; fixedPricePer1kOutput: number; dailyTokenLimit: number; maxConcurrency: number }) => Promise<void>;
  t: (key: string) => string;
}) {
  const [inputPrice, setInputPrice] = useState(String(offering.fixedPricePer1kInput ?? 0));
  const [outputPrice, setOutputPrice] = useState(String(offering.fixedPricePer1kOutput ?? 0));
  const [dailyLimit, setDailyLimit] = useState(String(offering.dailyTokenLimit ?? 0));
  const [maxConc, setMaxConc] = useState(String(offering.maxConcurrency ?? 0));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        fixedPricePer1kInput: Number(inputPrice) || 0,
        fixedPricePer1kOutput: Number(outputPrice) || 0,
        dailyTokenLimit: Number(dailyLimit) || 0,
        maxConcurrency: Number(maxConc) || 0,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-panel border border-line rounded-[var(--radius-card)] p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary mb-1">{t("nodeConfig.title")}</h3>
        <p className="text-xs text-text-tertiary mb-5 font-mono">{offering.logicalModel}</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">{t("nodeConfig.inputPrice")}</label>
            <input
              type="number"
              value={inputPrice}
              onChange={(e) => setInputPrice(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-line px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            />
            <p className="text-[10px] text-text-tertiary mt-1">{t("nodeConfig.inputPriceHint")}</p>
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">{t("nodeConfig.outputPrice")}</label>
            <input
              type="number"
              value={outputPrice}
              onChange={(e) => setOutputPrice(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-line px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            />
            <p className="text-[10px] text-text-tertiary mt-1">{t("nodeConfig.outputPriceHint")}</p>
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">{t("nodeConfig.dailyLimit")}</label>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="1000000"
              className="w-full rounded-[var(--radius-input)] border border-line px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            />
            <p className="text-[10px] text-text-tertiary mt-1">{t("nodeConfig.dailyLimitHint")}</p>
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">{t("nodeConfig.maxConcurrency")}</label>
            <input
              type="number"
              value={maxConc}
              onChange={(e) => setMaxConc(e.target.value)}
              placeholder="2"
              className="w-full rounded-[var(--radius-input)] border border-line px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            />
            <p className="text-[10px] text-text-tertiary mt-1">{t("nodeConfig.maxConcurrencyHint")}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="rounded-[var(--radius-btn)] border border-line text-text-secondary px-4 py-1.5 text-xs font-medium hover:text-text-primary cursor-pointer bg-transparent transition-colors"
          >
            {t("nodeConfig.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-[var(--radius-btn)] border border-accent/30 text-accent px-4 py-1.5 text-xs font-medium hover:bg-accent/10 cursor-pointer bg-transparent transition-colors disabled:opacity-50"
          >
            {saving ? "..." : t("nodeConfig.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProvidingTab() {
  const { t } = useLocale();
  const myKey = getApiKey() ?? "";

  // ── Offering data ──
  const [catalog, setCatalog] = useState<ProviderPreset[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [supplyUsage, setSupplyUsage] = useState<SupplyUsageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [togglingId, setTogglingId] = useState("");

  // ── Node data ──
  const [tokens, setTokens] = useState<NodeToken[]>([]);
  const [nodes, setNodes] = useState<ConnectedNode[]>([]);

  // ── Add new modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<"key" | "node" | null>(null);

  // ── Key upload form state ──
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState("");

  // Model discovery
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const discoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-model pricing
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

  // ── Node token form state ──
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState("");
  const [revokingId, setRevokingId] = useState("");

  // ── Node token section collapsed ──
  const [nodesSectionOpen, setNodesSectionOpen] = useState(false);

  // ── Config modal ──
  const [configOffering, setConfigOffering] = useState<Offering | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [catalogRes, offeringsRes, usageRes, tokensRes, nodesRes] = await Promise.all([
        apiJson<{ data: ProviderPreset[] }>("/v1/provider-catalog"),
        apiJson<{ data: Offering[] }>("/v1/offerings"),
        apiJson<{ data: { items: SupplyUsageItem[] } }>("/v1/usage/supply").catch(() => ({ data: { items: [] } })),
        apiJson<{ data: NodeToken[] }>("/v1/nodes/tokens").catch(() => ({ data: [] as NodeToken[] })),
        apiJson<{ data: ConnectedNode[] }>("/v1/nodes").catch(() => ({ data: [] as ConnectedNode[] })),
      ]);
      setCatalog(catalogRes.data ?? []);
      setOfferings(offeringsRes.data ?? []);
      setSupplyUsage(usageRes.data?.items ?? []);
      setTokens(tokensRes.data ?? []);
      setNodes(nodesRes.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Provider helpers ──
  const providerMap = new Map<string, ProviderPreset>();
  for (const p of catalog) {
    if (!providerMap.has(p.id)) providerMap.set(p.id, p);
  }
  const providers = Array.from(providerMap.keys());
  const providerModels = catalog.filter((p) => p.id === selectedProvider);
  const firstPreset = providerModels[0];
  const providerLabel = firstPreset?.label ?? firstPreset?.name ?? selectedProvider;

  // ── Auto-discover models ──
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

  // Build selectable model list
  const selectableModels: { id: string; label: string; realModel: string; source: "discovered" | "preset" }[] = [];
  if (discoveryDone && !discoveryFailed && discoveredModels.length > 0) {
    for (const dm of discoveredModels) {
      selectableModels.push({ id: `discovered:${dm.id}`, label: dm.id, realModel: dm.id, source: "discovered" });
    }
  } else {
    for (const pm of providerModels) {
      selectableModels.push({ id: `preset:${pm.logicalModel}`, label: pm.logicalModel, realModel: pm.realModel, source: "preset" });
    }
  }

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

  // ── Publish handler ──
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
        setShowAddModal(false);
        setAddMode(null);
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

  const handleConfigSave = async (offeringId: string, data: { fixedPricePer1kInput: number; fixedPricePer1kOutput: number; dailyTokenLimit: number; maxConcurrency: number }) => {
    try {
      await apiJson(`/v1/offerings/${encodeURIComponent(offeringId)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    }
  };

  const getUsageForOffering = (offeringId: string): SupplyUsageItem | undefined => {
    return supplyUsage.find((u) => u.offeringId === offeringId);
  };

  // ── Node token handlers ──
  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setNewTokenValue("");
    setCreating(true);
    try {
      const res = await apiJson<{ data: { id: string; token: string } }>("/v1/nodes/tokens", {
        method: "POST",
        body: JSON.stringify({ label: newLabel.trim() || "default" }),
      });
      setNewTokenValue(res.data?.token ?? "");
      setSuccess(t("nodes.tokenCreated"));
      setNewLabel("");
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setError("");
    try {
      await apiJson(`/v1/nodes/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setRevokingId("");
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const isEnabled = (o: Offering) => o.enabled === 1 || o.enabled === true;
  const onlineNodes = nodes.filter((n) => n.status === "online");
  const hasL3Nodes = tokens.length > 0 || nodes.length > 0;

  return (
    <div>
      {/* API Key display */}
      {myKey && (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <p className="text-text-secondary text-xs mb-2">{t("network.apiKey")}</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-sm text-text-primary bg-bg-0/50 rounded-[var(--radius-input)] px-3 py-2 overflow-hidden text-ellipsis">
              {myKey.slice(0, 12)}{"*".repeat(20)}
            </code>
            <CopyButton text={myKey} label={t("network.copy")} copiedLabel={t("network.copied")} />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger whitespace-pre-line">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-success/10 border border-success/30 px-4 py-2.5 text-sm text-success">
          {success}
        </div>
      )}

      {/* Newly created token display */}
      {newTokenValue && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-accent/30 bg-accent/5 p-5">
          <p className="text-sm text-text-secondary mb-2">{t("nodes.copyTokenWarning")}</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-sm text-text-primary bg-bg-0/50 rounded-[var(--radius-input)] px-3 py-2 overflow-hidden text-ellipsis select-all">
              {newTokenValue}
            </code>
            <CopyButton text={newTokenValue} />
          </div>
        </div>
      )}

      {/* [+ Add new model] button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold tracking-tight">{t("modelsMgmt.myOfferings")}</h2>
        <button
          onClick={() => { setShowAddModal(true); setAddMode(null); }}
          className="rounded-[var(--radius-btn)] border border-accent/30 text-accent px-4 py-1.5 text-xs font-medium hover:bg-accent/10 cursor-pointer bg-transparent transition-colors"
        >
          {t("modelsMgmt.addNew")}
        </button>
      </div>

      {/* ── Add new modal ── */}
      {showAddModal && (
        <div className="rounded-[var(--radius-card)] border border-accent/20 bg-panel p-6 mb-6">
          {!addMode && (
            <div>
              <h3 className="text-sm font-semibold mb-4 text-text-primary">{t("modelsMgmt.chooseMode")}</h3>
              <div className="flex gap-3">
                <button
                  onClick={() => setAddMode("key")}
                  className="flex-1 rounded-[var(--radius-card)] border border-line hover:border-accent/30 bg-[rgba(16,21,34,0.4)] p-4 text-left transition-colors cursor-pointer"
                >
                  <div className="text-lg mb-1">☁️</div>
                  <p className="text-sm font-medium text-text-primary">{t("modelsMgmt.modeKey")}</p>
                  <p className="text-xs text-text-tertiary mt-1">{t("modelsMgmt.modeKeyDesc")}</p>
                </button>
                <button
                  onClick={() => setAddMode("node")}
                  className="flex-1 rounded-[var(--radius-card)] border border-line hover:border-accent/30 bg-[rgba(16,21,34,0.4)] p-4 text-left transition-colors cursor-pointer"
                >
                  <div className="text-lg mb-1">🖥️</div>
                  <p className="text-sm font-medium text-text-primary">{t("modelsMgmt.modeNode")}</p>
                  <p className="text-xs text-text-tertiary mt-1">{t("modelsMgmt.modeNodeDesc")}</p>
                </button>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="mt-3 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none"
              >
                {t("modelsMgmt.cancel")}
              </button>
            </div>
          )}

          {/* Key upload form */}
          {addMode === "key" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-text-primary">☁️ {t("modelsMgmt.modeKey")}</h3>
                <button
                  onClick={() => { setAddMode(null); setSelectedProvider(""); setApiKey(""); setSelectedModels(new Set()); }}
                  className="text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none"
                >
                  {t("modelsMgmt.back")}
                </button>
              </div>
              <form onSubmit={handlePublish} className="flex flex-col gap-5 max-w-lg">
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

                {selectedProvider && (
                  <FormInput
                    label={t("network.providerKey")}
                    type="password"
                    placeholder={t("network.providerKeyPlaceholder")}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                )}

                {/* Discovery status */}
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

                {/* Model selection with pricing */}
                {selectedProvider && selectableModels.length > 0 && !discovering && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-text-secondary text-xs">{t("network.selectModels")} ({providerLabel})</label>
                      {pricingGuidance && (pricingGuidance.platformMinInput > 0 || pricingGuidance.avg7dInputPricePer1k != null) && (
                        <span className="text-[10px] text-text-tertiary">
                          {pricingGuidance.platformMinInput > 0 && `min ${pricingGuidance.platformMinInput}/${pricingGuidance.platformMinOutput}`}
                          {pricingGuidance.platformMaxInput > 0 && ` · max ${pricingGuidance.platformMaxInput}/${pricingGuidance.platformMaxOutput}`}
                          {pricingGuidance.avg7dInputPricePer1k != null && ` · 7d avg ${pricingGuidance.avg7dInputPricePer1k}/${pricingGuidance.avg7dOutputPricePer1k}`}
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

                {/* Custom model input */}
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
          )}

          {/* Node token creation + install guide */}
          {addMode === "node" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-text-primary">🖥️ {t("modelsMgmt.modeNode")}</h3>
                <button
                  onClick={() => setAddMode(null)}
                  className="text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none"
                >
                  {t("modelsMgmt.back")}
                </button>
              </div>

              {/* Create token */}
              <form onSubmit={handleCreateToken} className="flex items-end gap-3 max-w-lg mb-6">
                <div className="flex-1">
                  <FormInput
                    label={t("nodes.tokenLabel")}
                    placeholder={t("nodes.tokenLabelPlaceholder")}
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                <FormButton type="submit" disabled={creating} className="shrink-0">
                  {creating ? t("nodes.creating") : t("nodes.create")}
                </FormButton>
              </form>

              {/* Install guide */}
              <h4 className="text-sm font-semibold mb-3 text-text-primary">{t("nodes.installGuide")}</h4>
              <p className="text-text-secondary text-sm mb-4">{t("nodes.installDesc")}</p>
              <div className="relative">
                <pre className="rounded-[var(--radius-input)] bg-bg-0/50 border border-line px-4 py-3 text-sm font-mono text-text-primary overflow-x-auto">
{`# Install xllmapi-node
npm install -g xllmapi-node

# Run with your token
xllmapi-node --token YOUR_TOKEN --api https://api.xllmapi.com`}
                </pre>
                <div className="absolute top-2 right-2">
                  <CopyButton
                    text={`npm install -g xllmapi-node\nxllmapi-node --token YOUR_TOKEN --api https://api.xllmapi.com`}
                  />
                </div>
              </div>

              <button
                onClick={() => { setShowAddModal(false); setAddMode(null); }}
                className="mt-4 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none"
              >
                {t("modelsMgmt.close")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── My Offerings list ── */}
      {offerings.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-8 text-center text-text-tertiary text-sm">
          {t("network.noOfferings")}
        </div>
      ) : (
        (() => {
          const activeOfferings = offerings.filter((o) => isOfferingActive(o, nodes));
          const inactiveOfferings = offerings.filter((o) => !isOfferingActive(o, nodes));

          const renderOfferingCard = (o: Offering, isInactive: boolean) => {
            const usage = getUsageForOffering(o.id);
            const enabled = isEnabled(o);
            const isL3 = o.executionMode === "local";
            const nodeForOffering = isL3 ? nodes.find(() => true) : undefined;
            const status = getOfferingStatus(o, nodes);
            const sc = statusConfig[status];

            return (
              <div
                key={o.id}
                className={`rounded-[var(--radius-card)] border bg-panel p-5 transition-colors ${
                  isInactive ? "border-line opacity-60" : enabled ? "border-accent/20" : "border-line opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="font-mono text-sm font-medium text-text-primary">{o.logicalModel}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-panel border border-line font-medium text-text-secondary">
                        {sc.icon} {t(sc.key)}
                      </span>
                      {isL3 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-medium">{"\u{1F5A5}\uFE0F"} {t("modelsMgmt.badgeLocal")}</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">{"\u2601\uFE0F"} {t("modelsMgmt.badgeHosted")}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">
                      <span>{t("network.realModel")}: <span className="font-mono text-text-tertiary">{o.realModel}</span></span>
                      <span>{t("network.created")}: {new Date(o.createdAt).toLocaleDateString()}</span>
                      {enabled && o.createdAt && (
                        <span>{t("network.runtime")}: {formatRuntime(o.createdAt)}</span>
                      )}
                      {isL3 && nodeForOffering && (
                        <>
                          <span>IP: {nodeForOffering.ip}</span>
                          <span>{formatTimeAgo(nodeForOffering.lastHeartbeat)}</span>
                        </>
                      )}
                      {status === "offline" && isL3 && nodeForOffering && (
                        <span className="text-text-tertiary">{t("modelsMgmt.lastOnline")}: {formatRelativeTime(nodeForOffering.lastHeartbeat)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {status === "notJoined" && (
                      <button
                        onClick={() => void toggleOffering(o)}
                        disabled={togglingId === o.id}
                        className="rounded-[var(--radius-btn)] border border-accent/30 text-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/10 cursor-pointer bg-transparent transition-colors disabled:opacity-50"
                      >
                        {t("modelsMgmt.publishToNetwork")}
                      </button>
                    )}
                    <button
                      onClick={() => !enabled ? setConfigOffering(o) : undefined}
                      disabled={enabled}
                      title={enabled ? t("modelsMgmt.configDisabled") : t("modelsMgmt.configure")}
                      className={`rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium border transition-colors ${
                        enabled
                          ? "border-line text-text-tertiary cursor-not-allowed bg-transparent opacity-50"
                          : "border-accent/30 text-accent hover:bg-accent/10 cursor-pointer bg-transparent"
                      }`}
                    >
                      {t("modelsMgmt.configure")}
                    </button>
                    <button
                      onClick={() => void toggleOffering(o)}
                      disabled={togglingId === o.id}
                      className={`rounded-[var(--radius-btn)] px-4 py-1.5 text-xs font-medium cursor-pointer border transition-colors ${
                        enabled
                          ? "border-danger/30 text-danger hover:bg-danger/10 bg-transparent"
                          : "border-accent/30 text-accent hover:bg-accent/10 bg-transparent"
                      } disabled:opacity-50`}
                    >
                      {togglingId === o.id ? "..." : enabled ? t("network.stop") : t("network.start")}
                    </button>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <div>
                    <span className="text-text-tertiary">in</span>
                    <span className="ml-1 text-text-primary font-mono">{formatTokens(o.fixedPricePer1kInput ?? 0)}</span>
                    <span className="mx-1.5 text-text-tertiary/30">/</span>
                    <span className="text-text-tertiary">out</span>
                    <span className="ml-1 text-text-primary font-mono">{formatTokens(o.fixedPricePer1kOutput ?? 0)}</span>
                  </div>
                  {(o.dailyTokenLimit ?? 0) > 0 && (
                    <div>
                      <span className="text-text-tertiary">{t("nodeConfig.dailyLimit")}</span>
                      <span className="ml-1.5 text-text-primary font-mono">{formatTokens(o.dailyTokenLimit!)}</span>
                    </div>
                  )}
                  {(o.maxConcurrency ?? 0) > 0 && (
                    <div>
                      <span className="text-text-tertiary">{t("nodeConfig.maxConcurrency")}</span>
                      <span className="ml-1.5 text-text-primary font-mono">{o.maxConcurrency}</span>
                    </div>
                  )}
                </div>
                <div className="mt-2 pt-2 border-t border-line flex gap-6 text-xs">
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
                    <span className="ml-1.5 text-accent font-medium">{formatTokens(usage?.supplierReward ?? 0)} xt</span>
                  </div>
                </div>
              </div>
            );
          };

          return (
            <div>
              {/* Active offerings */}
              {activeOfferings.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-text-primary mb-3">
                    {t("modelsMgmt.active")} ({activeOfferings.length})
                  </h3>
                  <div className="flex flex-col gap-3">
                    {activeOfferings.map((o) => renderOfferingCard(o, false))}
                  </div>
                </div>
              )}

              {/* Inactive offerings */}
              {inactiveOfferings.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-text-secondary mb-3">
                    {t("modelsMgmt.inactive")} ({inactiveOfferings.length})
                  </h3>
                  <div className="flex flex-col gap-3">
                    {inactiveOfferings.map((o) => renderOfferingCard(o, true))}
                  </div>
                </div>
              )}
            </div>
          );
        })()
      )}

      {/* ── Node tokens section (collapsible, only if L3 nodes exist) ── */}
      {hasL3Nodes && (
        <div className="mt-8">
          <button
            onClick={() => setNodesSectionOpen(!nodesSectionOpen)}
            className="flex items-center gap-2 text-sm font-semibold text-text-primary cursor-pointer bg-transparent border-none mb-3"
          >
            <span className={`transition-transform ${nodesSectionOpen ? "rotate-90" : ""}`}>▸</span>
            {t("modelsMgmt.nodeTokens")}
            <span className="text-xs text-text-tertiary font-normal ml-2">
              {onlineNodes.length} {t("nodes.online")} / {nodes.length} {t("nodes.total")}
            </span>
          </button>

          {nodesSectionOpen && (
            <div className="flex flex-col gap-4">
              {/* Connected Nodes */}
              {nodes.length > 0 && (
                <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
                  <h3 className="text-sm font-semibold mb-3 text-text-primary">{t("nodes.connectedNodes")}</h3>
                  <div className="flex flex-col gap-2">
                    {nodes.map((node) => (
                      <div key={node.id} className={`flex items-center justify-between gap-4 rounded-[var(--radius-input)] border px-4 py-3 ${
                        node.status === "online" ? "border-accent/20" : "border-line opacity-70"
                      }`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="relative flex h-2.5 w-2.5 shrink-0">
                            {node.status === "online" && (
                              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
                            )}
                            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${node.status === "online" ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
                          </span>
                          <span className="font-mono text-sm text-text-primary truncate">{node.id.slice(0, 12)}</span>
                        </div>
                        <div className="flex items-center gap-5 text-xs text-text-secondary shrink-0">
                          <span>{node.ip}</span>
                          <span>{node.modelsCount} {t("nodes.models")}</span>
                          <span className="text-text-tertiary">{formatTimeAgo(node.lastHeartbeat)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Token list */}
              <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
                <h3 className="text-sm font-semibold mb-3 text-text-primary">{t("nodes.tokens")}</h3>
                {tokens.length === 0 ? (
                  <p className="text-text-tertiary text-sm">{t("nodes.noTokens")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tokens.map((tk) => (
                      <div key={tk.id} className="flex items-center justify-between gap-4 rounded-[var(--radius-input)] border border-line px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-sm text-text-primary truncate">{tk.label}</span>
                          <Badge>{tk.status}</Badge>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-text-tertiary">{new Date(tk.createdAt).toLocaleDateString()}</span>
                          <button
                            onClick={() => void handleRevoke(tk.id)}
                            disabled={revokingId === tk.id}
                            className="rounded-[var(--radius-btn)] border border-danger/30 text-danger px-3 py-1 text-xs font-medium hover:bg-danger/10 cursor-pointer bg-transparent transition-colors disabled:opacity-50"
                          >
                            {revokingId === tk.id ? "..." : t("nodes.revoke")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Create new token */}
                <form onSubmit={handleCreateToken} className="flex items-end gap-3 max-w-lg mt-4 pt-4 border-t border-line">
                  <div className="flex-1">
                    <FormInput
                      label={t("nodes.tokenLabel")}
                      placeholder={t("nodes.tokenLabelPlaceholder")}
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                    />
                  </div>
                  <FormButton type="submit" disabled={creating} className="shrink-0">
                    {creating ? t("nodes.creating") : t("nodes.create")}
                  </FormButton>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Config modal */}
      {configOffering && (
        <ConfigModal
          offering={configOffering}
          onClose={() => setConfigOffering(null)}
          onSave={(data) => handleConfigSave(configOffering.id, data)}
          t={t}
        />
      )}
    </div>
  );
}
