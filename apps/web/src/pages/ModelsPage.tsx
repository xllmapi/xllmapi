import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { formatTokens, getContextLimit, formatContextLength } from "@/lib/utils";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";
import { Cpu, Users } from "lucide-react";

interface NetworkModel {
  logicalModel: string;
  providerCount?: number;
  ownerCount?: number;
  status?: string;
  providers?: string[];
  minInputPrice?: number | null;
  minOutputPrice?: number | null;
  contextLength?: number;
  featuredSuppliers?: { handle: string; displayName: string }[];
  thirdParty?: boolean;
  thirdPartyLabel?: string;
  trustLevel?: string;
  presetId?: string | null;
  presetLabel?: string | null;
}

interface ModelStats {
  logicalModel: string;
  totalRequests: number;
  totalTokens: number;
  totalXtokens?: number;
  last7dTrend: number[];
  presetId?: string;
}

interface TrendDay {
  date: string;
  models: Record<string, { requests: number; tokens: number; xtokens: number; users: number; avgPrice: number }>;
}

interface DistributedOffering {
  id: string;
  logicalModel: string;
  ownerDisplayName?: string;
  ownerHandle?: string;
  executionMode?: string;
  enabled?: boolean;
  reviewStatus?: string;
  upvotes?: number;
  downvotes?: number;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  cacheReadDiscount?: number;
  uptimeSeconds?: number;
  publicNodeId?: string;
  contextLength?: number;
  maxConcurrency?: number;
  favoriteCount?: number;
  totalRequests?: number;
  requests7d?: number;
  last7dTrendRaw?: string;
}

type TrendMetric = "requests" | "tokens" | "xtokens" | "price";

/** Generate a stable, high-contrast color from model name using golden angle spacing */
function getModelColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
  }
  const hue = (hash * 137.508) % 360;
  return `hsl(${Math.round(hue)}, 70%, 60%)`;
}

/** SVG Area Chart for trends */
function TrendChart({ data, metric, allModels, days = 7 }: { data: TrendDay[]; metric: TrendMetric; allModels: string[]; days?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fill in all dates in the range so chart always shows full span
  const filledData: TrendDay[] = (() => {
    const dataMap = new Map(data.map((d) => [d.date, d]));
    const result: TrendDay[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push(dataMap.get(key) ?? { date: key, models: {} });
    }
    return result;
  })();

  const W = containerW, H = 280, PX = 50, PY = 30;
  const chartW = W - PX * 2, chartH = H - PY * 2;

  // Extract values per model, compute totals, sort biggest first (bottom of stack)
  const rawSeries = allModels.map((model) => {
    const values = filledData.map((d) => {
      const m = d.models[model];
      if (!m) return 0;
      return metric === "requests" ? m.requests : metric === "tokens" ? m.tokens : metric === "xtokens" ? m.xtokens : m.avgPrice;
    });
    return { model, values, total: values.reduce((a, b) => a + b, 0) };
  });

  // Filter out models with zero data, sort by total descending (biggest = bottom of stack)
  const activeSeries = rawSeries.filter((s) => s.total > 0).sort((a, b) => b.total - a.total);
  const sortedModels = activeSeries.map((s) => s.model);
  const seriesData = activeSeries.map((s) => s.values);

  // For price: overlay (not stacked). For others: stacked cumulative sums.
  const isOverlay = metric === "price";
  const stacked: number[][] = seriesData.map(() => new Array(filledData.length).fill(0) as number[]);
  for (let day = 0; day < filledData.length; day++) {
    let cum = 0;
    for (let s = 0; s < sortedModels.length; s++) {
      if (isOverlay) {
        stacked[s]![day] = seriesData[s]![day]!;
      } else {
        cum += seriesData[s]![day]!;
        stacked[s]![day] = cum;
      }
    }
  }

  const maxVal = isOverlay
    ? Math.max(...seriesData.flat(), 1)
    : Math.max(...(stacked[sortedModels.length - 1] ?? [0]), 1);

  const x = (i: number) => PX + (i / Math.max(filledData.length - 1, 1)) * chartW;
  const y = (v: number) => PY + chartH - (v / maxVal) * chartH;

  // Build area paths (bottom to top)
  const areas = sortedModels.map((model, s) => {
    const top = filledData.map((_, i) => `${x(i)},${y(stacked[s]![i]!)}`).join(" ");
    const prevBottom = s === 0
      ? filledData.map((_, i) => `${x(i)},${y(0)}`).reverse().join(" ")
      : filledData.map((_, i) => `${x(i)},${y(stacked[s - 1]![i]!)}`).reverse().join(" ");
    return { model, color: getModelColor(model), d: `M${top} L${prevBottom} Z` };
  });

  // X-axis labels (show ~8 labels)
  const labelStep = Math.max(Math.floor(filledData.length / 8), 1);
  const xLabels = filledData.filter((_, i) => i % labelStep === 0 || i === filledData.length - 1).map((d) => ({
    x: x(filledData.indexOf(d)),
    label: d.date.slice(5), // MM-DD
  }));

  // Y-axis labels
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = (maxVal / ySteps) * i;
    return { y: y(v), label: v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(Math.round(v)) };
  });

  return (
    <div ref={containerRef}>
      <svg width={W} height={H}>
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <line key={i} x1={PX} x2={W - PX} y1={yl.y} y2={yl.y} stroke="rgba(136,154,196,0.08)" strokeWidth="1" />
        ))}
        {/* Y labels */}
        {yLabels.map((yl, i) => (
          <text key={i} x={PX - 6} y={yl.y + 4} textAnchor="end" className="fill-text-tertiary" fontSize="11">{yl.label}</text>
        ))}
        {/* Areas (render bottom to top) — skip for price overlay */}
        {!isOverlay && areas.map((a) => (
          <path key={a.model} d={a.d} fill={a.color} opacity="0.25" />
        ))}
        {/* Lines on top — only draw segments where this model has data */}
        {sortedModels.map((model, s) => {
          // Build segments: only connect consecutive days where this model contributed
          const segments: string[][] = [];
          let current: string[] = [];
          for (let i = 0; i < filledData.length; i++) {
            const hasData = seriesData[s]![i]! > 0;
            if (hasData) {
              current.push(`${x(i)},${y(stacked[s]![i]!)}`);
            } else {
              if (current.length > 0) { segments.push(current); current = []; }
            }
          }
          if (current.length > 0) segments.push(current);
          return segments.map((seg, si) => (
            <polyline key={`${model}-${si}`} points={seg.join(" ")} fill="none" stroke={getModelColor(model)} strokeWidth={isOverlay ? 2.5 : 2} opacity={isOverlay ? 1 : 0.8} />
          ));
        })}
        {/* X labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={H - 4} textAnchor="middle" className="fill-text-tertiary" fontSize="11">{xl.label}</text>
        ))}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-3 px-1">
        {sortedModels.map((model) => (
          <span key={model} className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: getModelColor(model) }} />
            {model}
          </span>
        ))}
      </div>
    </div>
  );
}


function StatusDot({ status }: { status: string }) {
  const color = status === "available" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <span className="relative flex h-2 w-2">
      <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-40 animate-ping`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 64, h = 18;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

function formatUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return "--";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function HeatBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1 rounded-full bg-line overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--color-accent), rgba(139,227,218,0.5))" }} />
    </div>
  );
}


type SortKey = "popular" | "requests" | "tokens" | "price" | "newest";

export function ModelsPage() {
  const [models, setModels] = useState<NetworkModel[]>([]);
  const [stats, setStats] = useState<ModelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState<TrendDay[]>([]);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("xtokens");
  const [trendDays, setTrendDays] = useState(7);
  const [sortBy, setSortBy] = useState<SortKey>("popular");
  const [search, setSearch] = useState("");
  const [filterOnline, setFilterOnline] = useState(false);
  const [filterVerified] = useState(false);
  const [distributedOfferings, setDistributedOfferings] = useState<DistributedOffering[]>([]);
  const [distributedLoading, setDistributedLoading] = useState(true);
  const { t } = useLocale();
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      apiJson<{ data: NetworkModel[] }>("/v1/network/models"),
      apiJson<{ data: ModelStats[] }>("/v1/network/models/stats").catch(() => ({ data: [] })),
      apiJson<{ data: TrendDay[] }>(`/v1/network/trends?days=${trendDays}`).catch(() => ({ data: [] })),
    ]).then(([modelsRes, statsRes, trendRes]) => {
      setModels((modelsRes.data ?? []).filter((m) => !m.logicalModel.startsWith("community-") && !m.logicalModel.startsWith("e2e-")));
      setStats(statsRes.data ?? []);
      setTrendData(trendRes.data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [trendDays]);

  useEffect(() => {
    setDistributedLoading(true);
    apiJson<{ data: { data: DistributedOffering[]; total: number } | DistributedOffering[] }>("/v1/market/offerings?executionMode=node&limit=50")
      .then((r) => {
        const items = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        setDistributedOfferings(items);
      })
      .catch(() => {})
      .finally(() => setDistributedLoading(false));
  }, []);

  const statsMap = new Map(stats.map((s) => [s.presetId ? `${s.logicalModel}::${s.presetId}` : s.logicalModel, s]));
  const totalNodes = models.reduce((sum, m) => sum + (m.ownerCount ?? 0), 0);
  const totalSuppliers = new Set(models.flatMap((m) => (m.featuredSuppliers ?? []).map((s) => s.handle))).size;
  const totalXtokens = stats.reduce((sum, s) => sum + (s.totalXtokens ?? s.totalTokens ?? 0), 0);
  const maxRequests = Math.max(...stats.map((s) => s.totalRequests), 1);

  const filtered = models.filter((m) => {
    const q = search.toLowerCase();
    if (q) {
      const nameMatch = m.logicalModel.toLowerCase().includes(q);
      const supplierMatch = (m.featuredSuppliers ?? []).some((s) => s.displayName.toLowerCase().includes(q) || s.handle.toLowerCase().includes(q));
      const labelMatch = (m.presetLabel ?? "").toLowerCase().includes(q);
      if (!nameMatch && !supplierMatch && !labelMatch) return false;
    }
    if (filterOnline && m.status !== "available") return false;
    if (filterVerified && !(m.providers && m.providers.length > 0)) return false;
    return true;
  });
  const sortFn = (a: NetworkModel, b: NetworkModel) => {
    const sa = statsMap.get(a.presetId ? `${a.logicalModel}::${a.presetId}` : a.logicalModel), sb = statsMap.get(b.presetId ? `${b.logicalModel}::${b.presetId}` : b.logicalModel);
    if (sortBy === "popular") return (b.ownerCount ?? 0) - (a.ownerCount ?? 0);
    if (sortBy === "requests") return (sb?.totalRequests ?? 0) - (sa?.totalRequests ?? 0);
    if (sortBy === "tokens") return (sb?.totalTokens ?? 0) - (sa?.totalTokens ?? 0);
    if (sortBy === "newest") return (b.logicalModel > a.logicalModel ? 1 : -1);
    return (a.minInputPrice ?? 9999) - (b.minInputPrice ?? 9999);
  };
  const officialModels = [...filtered].filter((m) => !m.thirdParty).sort(sortFn);
  const thirdPartyModels = [...filtered].filter((m) => m.thirdParty).sort(sortFn);
  const sorted = [...officialModels, ...thirdPartyModels];

  return (
    <div className="min-h-screen flex flex-col pt-14">
      {/* Section 1: Header + Stats */}
      <section className="pt-16 pb-10 px-6 text-center">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">{t("models.title")}</h1>
        <p className="text-text-secondary text-base max-w-xl mx-auto">{t("models.subtitle")}</p>
      </section>

      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
          {[
            { value: models.length + new Set(distributedOfferings.map((o) => o.logicalModel)).size, label: t("models.stat.models") },
            { value: totalNodes + distributedOfferings.length, label: t("models.stat.nodes") },
            { value: totalSuppliers + new Set(distributedOfferings.map((o) => o.ownerHandle).filter(Boolean)).size, label: t("models.stat.suppliers") },
            { value: formatTokens(totalXtokens), label: t("models.stat.tokens") },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-2xl font-bold text-accent">{s.value}</div>
              <div className="text-xs text-text-tertiary mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: Trend Chart */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-10 w-full">
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-text-secondary">{t("models.trends.title")}</h2>
              <div className="flex items-center bg-panel-strong rounded-md p-0.5">
                {[7, 30].map((d) => (
                  <button key={d} onClick={() => setTrendDays(d)}
                    className={`px-2.5 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                      trendDays === d ? "bg-bg-1 text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                    }`}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                {(["xtokens", "tokens", "requests", "price"] as TrendMetric[]).map((m) => (
                  <button key={m} onClick={() => setTrendMetric(m)}
                    className={`px-3 py-1 text-xs rounded-full transition-colors cursor-pointer border ${
                      trendMetric === m ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-text-tertiary hover:text-text-secondary"
                    }`}>
                    {t(`models.trends.${m}`)}
                  </button>
                ))}
              </div>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("models.searchSupplier")}
                className="rounded-[var(--radius-input)] border border-line px-3 py-1.5 text-sm text-text-primary w-full sm:w-52 focus:outline-none focus:border-accent transition-colors font-mono"
                style={{ backgroundColor: "rgba(16,21,34,0.6)" }} />
            </div>
          </div>
          <TrendChart
            data={trendData}
            metric={trendMetric}
            allModels={[...new Set(trendData.flatMap((d) => Object.keys(d.models)))]}
            days={trendDays}
          />
        </div>
      </section>

      {/* Section 3: Platform Models */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-10 w-full">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">{t("models.platformModels")}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {(["popular", "requests", "tokens", "price", "newest"] as SortKey[]).map((key) => (
                <button key={key} onClick={() => setSortBy(key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer border ${sortBy === key ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-text-tertiary hover:text-text-secondary"}`}>
                  {t(`models.sort.${key}`)}
                </button>
              ))}
            </div>
            <button onClick={() => setFilterOnline(!filterOnline)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer border ${filterOnline ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-400" : "border-line text-text-tertiary hover:text-text-secondary"}`}>
              {filterOnline ? t("models.filter.onlineOnly") : t("models.filter.all")}
            </button>
          </div>
        </div>
        <div className="h-px bg-line mb-5" />

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-[var(--radius-card)] border border-line bg-panel p-5 animate-pulse">
                <div className="h-4 bg-line rounded w-2/3 mb-3" />
                <div className="h-3 bg-line rounded w-1/2 mb-2" />
                <div className="h-2 bg-line rounded w-full" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-text-tertiary py-20">{t("models.empty")}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((m) => {
              const s = statsMap.get(m.presetId ? `${m.logicalModel}::${m.presetId}` : m.logicalModel);
              return (
                <div key={m.presetId ? `${m.logicalModel}::${m.presetId}` : m.logicalModel}
                  onClick={() => navigate(`/mnetwork/${encodeURIComponent(m.logicalModel)}${m.presetId ? `?provider=${encodeURIComponent(m.presetId)}` : ''}`)}
                  className={`rounded-[var(--radius-card)] border p-5 transition-colors cursor-pointer ${
                    m.thirdParty
                      ? m.trustLevel === "low"
                        ? "border-red-500/20 bg-red-500/5 hover:border-red-500/40"
                        : m.trustLevel === "medium"
                          ? "border-orange-500/20 bg-orange-500/5 hover:border-orange-500/40"
                          : "border-teal-500/20 bg-teal-500/5 hover:border-teal-500/40"
                      : "border-blue-500/20 bg-blue-500/5 hover:border-blue-500/40"
                  }`}>

                  {/* Name + status + third-party badge */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 truncate mr-2">
                      <span className="text-sm font-mono font-medium text-text-primary truncate">{m.logicalModel}</span>
                      {m.presetLabel && (
                        <span className="text-[10px] text-text-tertiary shrink-0">{m.presetLabel}</span>
                      )}
                      {m.thirdParty && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${
                          m.trustLevel === "low" ? "bg-red-500/10 border-red-500/20 text-red-400"
                            : m.trustLevel === "medium" ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                            : "bg-teal-500/10 border-teal-500/20 text-teal-400"
                        }`}>
                          {m.thirdPartyLabel || t("models.thirdParty")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusDot status={m.status ?? "available"} />
                      <span className="text-[10px] text-text-tertiary capitalize">{m.status ?? "available"}</span>
                    </div>
                  </div>

                  {/* Nodes + suppliers + context */}
                  <div className="flex items-center gap-4 text-xs text-text-secondary mb-3">
                    <span className="flex items-center gap-1"><Cpu className="w-3 h-3 text-text-tertiary" />{m.ownerCount ?? 0} {t("models.nodes")}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3 text-text-tertiary" />{m.ownerCount ?? 0} {t("models.suppliers")}</span>
                    <span className="text-text-tertiary">{formatContextLength(m.contextLength ?? getContextLimit(m.logicalModel))} {t("common.contextShort")}</span>
                  </div>

                  {/* Price + stats */}
                  <div className="flex items-center justify-between text-xs mb-2">
                    {m.minInputPrice != null ? (
                      <div className="flex items-center gap-2">
                        <span className="text-text-tertiary">{t("models.avgPrice7d")}</span>
                        <span className="text-accent font-medium">{formatTokens(m.minInputPrice)}<span className="text-text-tertiary/40 mx-0.5">/</span>{formatTokens(m.minOutputPrice ?? 0)}</span>
                      </div>
                    ) : (
                      <span className="text-text-tertiary">{t("models.noPrice")}</span>
                    )}
                    <span className="text-text-tertiary">{s?.totalRequests ?? 0} {t("models.requests")}</span>
                  </div>

                  {/* Heat bar + sparkline */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1"><HeatBar value={s?.totalRequests ?? 0} max={maxRequests} /></div>
                    {s?.last7dTrend && <Sparkline data={s.last7dTrend} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 4: Distributed Nodes */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-16 w-full flex-1">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">{t("models.distributedNodes")}</h2>
        </div>
        <div className="h-px bg-line mb-5" />

        {distributedLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-[var(--radius-card)] border border-line bg-panel p-5 animate-pulse">
                <div className="h-4 bg-line rounded w-2/3 mb-3" />
                <div className="h-3 bg-line rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : distributedOfferings.length === 0 ? (
          <div className="text-center text-text-tertiary py-16">{t("models.noDistributed")}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {distributedOfferings.map((o) => {
              const isOnline = o.enabled !== false && o.reviewStatus === "approved";
              return (
                <div key={o.id} onClick={() => navigate(`/mnetwork/node/${encodeURIComponent(o.publicNodeId || o.id)}`)}
                  className="rounded-[var(--radius-card)] border border-purple-500/20 bg-purple-500/5 p-5 transition-colors hover:border-purple-500/40 cursor-pointer">
                  {/* Row 1: Model + badge + connections + status */}
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-mono font-medium text-text-primary truncate">{o.logicalModel}</span>
                      <span className="text-[10px] px-1 py-0.5 rounded font-medium bg-purple-500/10 text-purple-400 shrink-0">🖥️</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-[11px] text-text-tertiary" title={t("models.usersJoined")}>🔗 {o.favoriteCount ?? 0}</span>
                      <div className="flex items-center gap-1">
                        <span className="relative flex h-2 w-2">
                          {isOnline && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />}
                          <span className={`relative inline-flex h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
                        </span>
                        <span className="text-[10px] text-text-tertiary">{isOnline ? t("models.online") : t("models.offline")}</span>
                      </div>
                    </div>
                  </div>
                  {/* Row 2: Operator */}
                  <div className="text-xs text-text-secondary mb-3 truncate">
                    @{o.ownerHandle || "—"}
                    {o.ownerDisplayName && o.ownerHandle !== o.ownerDisplayName ? ` (${o.ownerDisplayName})` : ""}
                  </div>
                  {/* Row 3: Price + ctx · concurrency  |  requests */}
                  <div className="flex items-center justify-between text-xs mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-accent font-medium">{formatTokens(o.fixedPricePer1kInput ?? 0)}<span className="text-text-tertiary/40 mx-0.5">/</span>{formatTokens(o.fixedPricePer1kOutput ?? 0)}</span>
                      {o.cacheReadDiscount != null && o.cacheReadDiscount < 100 && (
                        <span className="text-green-500 text-[10px]" title={t("models.cacheDiscount")}>cache {o.cacheReadDiscount}%</span>
                      )}
                      {o.contextLength != null && o.contextLength > 0 && (
                        <><span className="text-text-tertiary/30">·</span><span className="text-text-tertiary">{formatContextLength(o.contextLength)}</span></>
                      )}
                      {o.maxConcurrency != null && (
                        <><span className="text-text-tertiary/30">·</span><span className="text-text-tertiary">{t("models.concurrency")} {o.maxConcurrency}</span></>
                      )}
                    </div>
                    <span className="text-text-tertiary">{o.requests7d ?? 0} {t("models.requests")}</span>
                  </div>
                  {/* Row 4: uptime · latency  |  sparkline */}
                  <div className="flex items-center justify-between text-[11px] text-text-tertiary">
                    <div className="flex items-center gap-1.5">
                      <span>{t("nodeDetail.uptime")} {formatUptime(o.uptimeSeconds)}</span>
                      <span className="text-text-tertiary/30">·</span>
                      <span>{t("nodeDetail.avgLatency")} --</span>
                    </div>
                    {(() => {
                      try {
                        const trend: number[] = o.last7dTrendRaw ? JSON.parse(o.last7dTrendRaw) : [];
                        return trend.length > 0 ? <Sparkline data={trend} /> : null;
                      } catch { return null; }
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
