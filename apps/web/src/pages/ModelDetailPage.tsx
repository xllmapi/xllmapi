import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { formatTokens } from "@/lib/utils";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";
import { invalidateUserModels } from "@/hooks/useUserModels";

interface NetworkModel {
  logicalModel: string;
  ownerCount?: number;
  status?: string;
  providers?: string[];
  minInputPrice?: number | null;
  minOutputPrice?: number | null;
  featuredSuppliers?: { handle: string; displayName: string }[];
}

interface ModelStats {
  logicalModel: string;
  totalRequests: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  uniqueUsers: number;
  last7dTrend: number[];
}

/** SVG bar chart for 7-day trend */
function BarChart7d({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const w = 280, h = 80, barW = 28, gap = 12;
  const days = ["", "", "", "", "", "", ""];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    days[i] = `${d.getMonth() + 1}/${d.getDate()}`;
  }

  return (
    <svg width={w} height={h + 20} className="w-full max-w-[280px]">
      {data.map((v, i) => {
        const barH = max > 0 ? (v / max) * h : 0;
        const x = i * (barW + gap);
        return (
          <g key={i}>
            <rect x={x} y={h - barH} width={barW} height={Math.max(barH, 1)} rx={3}
              fill="var(--color-accent)" opacity={v > 0 ? 0.6 : 0.15} />
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" className="fill-text-tertiary" fontSize="9">
              {days[i]}
            </text>
            {v > 0 && (
              <text x={x + barW / 2} y={h - barH - 4} textAnchor="middle" className="fill-text-secondary" fontSize="9">
                {v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

interface SupplierOffering {
  id: string;
  logicalModel: string;
  ownerDisplayName?: string;
  ownerHandle?: string;
  executionMode?: string;
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
  createdAt?: string;
}

function formatRuntime(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const diffMs = now - created;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diffMs / (1000 * 60));
  return `${mins}m`;
}

type SupplierSort = "price" | "longest";

export function ModelDetailPage() {
  const { logicalModel } = useParams<{ logicalModel: string }>();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [model, setModel] = useState<NetworkModel | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierOffering[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinChecking, setJoinChecking] = useState(true);
  const [supplierSort, setSupplierSort] = useState<SupplierSort>("price");

  // Check if model is platform type
  const isPlatformModel = model?.providers && model.providers.length > 0;

  // Fetch model + stats
  useEffect(() => {
    Promise.all([
      apiJson<{ data: NetworkModel[] }>("/v1/network/models"),
      apiJson<{ data: ModelStats[] }>("/v1/network/models/stats").catch(() => ({ data: [] })),
    ]).then(([modelsRes, statsRes]) => {
      const m = (modelsRes.data ?? []).find((x) => x.logicalModel === logicalModel) ?? null;
      const s = (statsRes.data ?? []).find((x) => x.logicalModel === logicalModel) ?? null;
      setModel(m);
      setStats(s);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [logicalModel]);

  // Fetch suppliers for this model
  useEffect(() => {
    if (!logicalModel) return;
    setSuppliersLoading(true);
    const params = new URLSearchParams({ logicalModel, limit: "100" });
    apiJson<{ data: { data: SupplierOffering[]; total: number } | SupplierOffering[] }>(`/v1/market/offerings?${params}`)
      .then((res) => {
        const items = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        setSuppliers(items.slice(0, 10));
      })
      .catch(() => {})
      .finally(() => setSuppliersLoading(false));
  }, [logicalModel]);

  // Check if user has joined this model
  useEffect(() => {
    if (!logicalModel) return;
    setJoinChecking(true);
    apiJson<{ data: { joined: boolean } }>(`/v1/me/connection-pool/model/${encodeURIComponent(logicalModel)}`)
      .then((res) => {
        setJoined(res.data?.joined ?? false);
      })
      .catch(() => {
        // If 404 or error, assume not joined
        setJoined(false);
      })
      .finally(() => setJoinChecking(false));
  }, [logicalModel]);

  const handleJoinLeave = useCallback(async () => {
    if (!logicalModel || joinLoading) return;
    setJoinLoading(true);
    try {
      if (joined) {
        await apiJson(`/v1/me/connection-pool/model/${encodeURIComponent(logicalModel)}`, { method: "DELETE" });
        setJoined(false);
      } else {
        await apiJson(`/v1/me/connection-pool/model/${encodeURIComponent(logicalModel)}`, { method: "POST" });
        setJoined(true);
      }
      invalidateUserModels();
    } catch {
      // ignore
    } finally {
      setJoinLoading(false);
    }
  }, [logicalModel, joined, joinLoading]);

  // Sort suppliers
  const sortedSuppliers = [...suppliers].sort((a, b) => {
    if (supplierSort === "price") {
      return (a.fixedPricePer1kInput ?? 9999) - (b.fixedPricePer1kInput ?? 9999);
    }
    // longest = oldest createdAt first
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Date.now();
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Date.now();
    return aTime - bTime;
  });

  if (loading) {
    return (
      <div className="min-h-screen pt-14">
        <div className="mx-auto max-w-2xl px-6 pt-16">
          <div className="animate-pulse">
            <div className="h-6 bg-line rounded w-1/3 mb-4" />
            <div className="h-4 bg-line rounded w-1/2 mb-8" />
            <div className="h-24 bg-line rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary mb-4">Model not found: {logicalModel}</p>
          <button onClick={() => navigate("/mnetwork")} className="text-accent hover:underline cursor-pointer">{t("models.back")}</button>
        </div>
      </div>
    );
  }

  const totalTokens = stats?.totalTokens ?? 0;

  return (
    <div className="min-h-screen flex flex-col pt-14">
      <div className="mx-auto max-w-2xl px-6 pt-8 pb-24 flex-1 w-full">
        {/* Back button */}
        <div className="mb-6">
          <button onClick={() => navigate("/mnetwork")}
            className="text-xs text-text-tertiary hover:text-accent transition-colors cursor-pointer bg-transparent border-none p-0">
            {t("models.back")}
          </button>
        </div>

        {/* Header card with join button inside */}
        <div className={`mb-8 rounded-[var(--radius-card)] p-5 border ${isPlatformModel ? "border-blue-500/20 bg-blue-500/5" : "border-purple-500/20 bg-purple-500/5"}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold font-mono tracking-tight">{model.logicalModel}</h1>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${model.status === "available" ? "border-emerald-400/30 text-emerald-400" : "border-amber-400/30 text-amber-400"}`}>
                  {model.status === "available" ? "\uD83D\uDFE2" : "\uD83D\uDFE1"} {model.status ?? "available"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-secondary">
                <span>{model.ownerCount ?? 0} {t("models.nodes")}</span>
                <span className="text-text-tertiary/40">&middot;</span>
                <span>{(model.featuredSuppliers ?? []).length || (model.ownerCount ?? 0)} {t("models.suppliers")}</span>
              </div>
            </div>

            {!joinChecking && (
              <button
                onClick={handleJoinLeave}
                disabled={joinLoading}
                className={`rounded-[var(--radius-btn)] px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer border shrink-0 ${
                  joined
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-accent/30 text-accent hover:bg-accent/10 bg-transparent"
                } ${joinLoading ? "opacity-50" : ""}`}
              >
                {joinLoading ? "..." : joined ? `${t("modelDetail.joined")} \u2713` : t("modelDetail.joinList")}
              </button>
            )}
          </div>
        </div>

        {/* Model Info */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("modelDetail.modelInfo")}</h3>
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-tertiary text-xs">{t("models.avgPrice7d")}</span>
              <span className="font-mono text-text-primary">
                {model.minInputPrice != null
                  ? <>{formatTokens(model.minInputPrice)}<span className="text-text-tertiary/40 mx-0.5">/</span>{formatTokens(model.minOutputPrice ?? 0)} <span className="text-text-tertiary text-[10px]">per 1K tokens: input xtokens / output xtokens</span></>
                  : "\u2014"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-tertiary text-xs">{t("models.requests")}</span>
              <span className="font-mono text-text-primary">{stats?.totalRequests ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-tertiary text-xs">Total Tokens</span>
              <span className="font-mono text-text-primary">{formatTokens(totalTokens)}</span>
            </div>
          </div>
        </div>

        {/* 7-day trend */}
        {stats?.last7dTrend && (
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
            <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("models.trend7d")}</h3>
            <BarChart7d data={stats.last7dTrend} />
          </div>
        )}

        {/* Suppliers */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-text-secondary">
              {t("modelDetail.suppliers")} ({suppliers.length})
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSupplierSort("price")}
                className={`px-2.5 py-1 text-[11px] rounded-full transition-colors cursor-pointer border ${
                  supplierSort === "price" ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {t("modelDetail.sortLowest")}
              </button>
              <button
                onClick={() => setSupplierSort("longest")}
                className={`px-2.5 py-1 text-[11px] rounded-full transition-colors cursor-pointer border ${
                  supplierSort === "longest" ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {t("modelDetail.sortLongest")}
              </button>
            </div>
          </div>

          {suppliersLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-8 bg-line rounded animate-pulse" />
              ))}
            </div>
          ) : sortedSuppliers.length === 0 ? (
            <p className="text-text-tertiary text-sm text-center py-6">{t("modelDetail.noOfferings")}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sortedSuppliers.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-panel-strong transition-colors text-xs">
                  <span className="text-text-primary font-medium truncate min-w-0">
                    {s.ownerDisplayName || s.ownerHandle || "\u2014"}
                  </span>
                  <span className="text-text-tertiary/40">&middot;</span>
                  <span className="font-mono text-text-secondary shrink-0">
                    {formatTokens(s.fixedPricePer1kInput)}/{formatTokens(s.fixedPricePer1kOutput)}
                  </span>
                  <span className="text-text-tertiary/40">&middot;</span>
                  <span className="text-text-tertiary shrink-0">
                    {t("modelDetail.running")} {s.createdAt ? formatRuntime(s.createdAt) : "\u2014"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
