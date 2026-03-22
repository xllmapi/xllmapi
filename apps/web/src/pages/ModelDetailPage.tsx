import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
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
      </div>

      <Footer />
    </div>
  );
}
