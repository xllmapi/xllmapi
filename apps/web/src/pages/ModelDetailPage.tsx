import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";

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

function formatTokens(v: number | string): string {
  const n = Number(v) || 0;
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
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

interface Offering {
  id: string;
  name?: string;
  logicalModel: string;
  supplierName?: string;
  supplierHandle?: string;
  online: boolean;
  verified?: boolean;
  reviewStatus?: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
}

/** Horizontal progress bar */
function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 rounded-full bg-line overflow-hidden flex-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function ModelDetailPage() {
  const { logicalModel } = useParams<{ logicalModel: string }>();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [model, setModel] = useState<NetworkModel | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [togglingFav, setTogglingFav] = useState<Set<string>>(new Set());

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

  // Fetch offerings for this model
  useEffect(() => {
    if (!logicalModel) return;
    setOfferingsLoading(true);
    const params = new URLSearchParams({ logicalModel, limit: "100" });
    Promise.all([
      apiJson<{ data: { data: Offering[]; total: number } }>(`/v1/market/offerings?${params}`).catch(() => ({ data: { data: [] as Offering[], total: 0 } })),
      apiJson<{ data: { offeringId: string }[] }>("/v1/user/favorites").catch(() => ({ data: [] as { offeringId: string }[] })),
    ]).then(([offRes, favRes]) => {
      const offerings = Array.isArray(offRes.data) ? offRes.data : (offRes.data?.data ?? []);
      setOfferings(offerings);
      setFavoriteIds(new Set((favRes.data ?? []).map((f) => f.offeringId)));
    }).finally(() => setOfferingsLoading(false));
  }, [logicalModel]);

  const toggleFavorite = useCallback(async (offeringId: string) => {
    setTogglingFav((prev) => new Set(prev).add(offeringId));
    try {
      if (favoriteIds.has(offeringId)) {
        await apiJson(`/v1/offerings/${offeringId}/favorite`, { method: "DELETE" });
        setFavoriteIds((prev) => { const next = new Set(prev); next.delete(offeringId); return next; });
      } else {
        await apiJson(`/v1/offerings/${offeringId}/favorite`, { method: "POST" });
        setFavoriteIds((prev) => new Set(prev).add(offeringId));
      }
    } catch { /* ignore */ }
    setTogglingFav((prev) => { const next = new Set(prev); next.delete(offeringId); return next; });
  }, [favoriteIds]);

  if (loading) {
    return (
      <div className="min-h-screen pt-14">
        <div className="mx-auto max-w-2xl px-6 pt-16">
          <div className="animate-pulse">
            <div className="h-6 bg-line rounded w-1/3 mb-4" />
            <div className="h-4 bg-line rounded w-1/2 mb-8" />
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-line rounded-lg" />)}
            </div>
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
  const inputTokens = stats?.totalInputTokens ?? 0;
  const outputTokens = stats?.totalOutputTokens ?? 0;

  return (
    <div className="min-h-screen flex flex-col pt-14">
      <div className="mx-auto max-w-2xl px-6 pt-8 pb-24 flex-1 w-full">
        {/* Back */}
        <button onClick={() => navigate("/mnetwork")}
          className="text-xs text-text-tertiary hover:text-accent transition-colors cursor-pointer mb-6 bg-transparent border-none p-0">
          {t("models.back")}
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold font-mono tracking-tight">{model.logicalModel}</h1>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${model.status === "available" ? "border-emerald-400/30 text-emerald-400" : "border-amber-400/30 text-amber-400"}`}>
              {model.status ?? "available"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            {model.providers?.map((p) => <span key={p} className="bg-accent/6 border border-accent/10 rounded-full px-2 py-0.5">{p}</span>)}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-xl font-bold text-text-primary">{stats?.totalRequests ?? 0}</div>
            <div className="text-[10px] text-text-tertiary mt-1">{t("models.detail.requests30d")}</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-xl font-bold text-text-primary">{formatTokens(totalTokens)}</div>
            <div className="text-[10px] text-text-tertiary mt-1">xtokens</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-xl font-bold text-text-primary">
              {model.minInputPrice != null ? `${model.minInputPrice}/${model.minOutputPrice}` : "—"}
            </div>
            <div className="text-[10px] text-text-tertiary mt-1">{t("models.price")}</div>
          </div>
        </div>

        {/* 7-day trend */}
        {stats?.last7dTrend && (
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
            <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("models.trend7d")}</h3>
            <BarChart7d data={stats.last7dTrend} />
          </div>
        )}

        {/* Token breakdown */}
        {totalTokens > 0 && (
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
            <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("models.tokenBreakdown")}</h3>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-tertiary w-14">Input</span>
                <ProgressBar value={inputTokens} max={totalTokens} color="var(--color-accent)" />
                <span className="text-xs text-text-secondary w-20 text-right">
                  {formatTokens(inputTokens)} ({totalTokens > 0 ? Math.round((inputTokens / totalTokens) * 100) : 0}%)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-tertiary w-14">Output</span>
                <ProgressBar value={outputTokens} max={totalTokens} color="rgba(139,227,218,0.5)" />
                <span className="text-xs text-text-secondary w-20 text-right">
                  {formatTokens(outputTokens)} ({totalTokens > 0 ? Math.round((outputTokens / totalTokens) * 100) : 0}%)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Suppliers + nodes */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">{t("models.suppliers")}</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {(model.featuredSuppliers ?? []).map((s) => (
              <span key={s.handle} className="text-xs text-text-primary bg-accent/8 border border-accent/15 rounded-full px-3 py-1 font-mono">
                {s.displayName}
              </span>
            ))}
            {(!model.featuredSuppliers || model.featuredSuppliers.length === 0) && (
              <span className="text-xs text-text-tertiary">—</span>
            )}
          </div>
          <div className="flex gap-4 text-xs text-text-tertiary">
            <span>{t("models.stat.nodes")}: {model.ownerCount ?? 0}</span>
            <span>{t("models.stat.suppliers")}: {model.ownerCount ?? 0}</span>
            {stats?.uniqueUsers != null && <span>{t("models.requests")}: {stats.uniqueUsers} users</span>}
          </div>
        </div>

        {/* Offerings / Nodes list */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
          <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("modelDetail.offerings")}</h3>
          {offeringsLoading ? (
            <div className="grid grid-cols-1 gap-3">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-lg border border-line bg-panel-strong p-4 animate-pulse">
                  <div className="h-4 bg-line rounded w-1/3 mb-2" />
                  <div className="h-3 bg-line rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : offerings.length === 0 ? (
            <p className="text-text-tertiary text-sm text-center py-6">{t("modelDetail.noOfferings")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {offerings.map((o) => {
                const isFav = favoriteIds.has(o.id);
                const isToggling = togglingFav.has(o.id);
                const verificationStatus = o.reviewStatus === "approved" || o.verified
                  ? "verified" : o.reviewStatus === "pending" ? "pending" : "unverified";
                return (
                  <div key={o.id} className="rounded-lg border border-line bg-panel-strong p-4 transition-colors hover:border-accent/20">
                    {/* Row 1: Name + Status */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-mono font-medium text-text-primary truncate mr-2">
                        {o.name || t("modelDetail.noName")}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Online/offline */}
                        <span className="flex items-center gap-1">
                          <span className={`inline-block h-2 w-2 rounded-full ${o.online ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
                          <span className="text-[10px] text-text-tertiary">{o.online ? t("modelDetail.online") : t("modelDetail.offline")}</span>
                        </span>
                        {/* Verification badge */}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          verificationStatus === "verified"
                            ? "bg-emerald-400/10 text-emerald-400"
                            : verificationStatus === "pending"
                              ? "bg-amber-400/10 text-amber-400"
                              : "bg-text-tertiary/10 text-text-tertiary"
                        }`}>
                          {verificationStatus === "verified" ? t("modelDetail.verified")
                            : verificationStatus === "pending" ? t("modelDetail.pending")
                              : t("modelDetail.unverified")}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: Supplier + price */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-text-secondary">
                        {o.supplierHandle ? (
                          <Link to={`/u/${o.supplierHandle}`} className="hover:text-accent transition-colors" onClick={(e) => e.stopPropagation()}>
                            {o.supplierName || o.supplierHandle}
                          </Link>
                        ) : (
                          <span>{o.supplierName || "—"}</span>
                        )}
                      </div>
                      <span className="text-xs font-mono text-text-tertiary">
                        {o.inputPricePer1k}/{o.outputPricePer1k} {t("modelDetail.pricePer1k")}
                      </span>
                    </div>

                    {/* Row 3: Add to list button */}
                    <button
                      onClick={() => toggleFavorite(o.id)}
                      disabled={isToggling}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer border ${
                        isFav
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line text-text-tertiary hover:text-text-secondary hover:border-accent/25"
                      } ${isToggling ? "opacity-50" : ""}`}
                    >
                      {isFav ? t("modelDetail.added") : t("modelDetail.addToList")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
