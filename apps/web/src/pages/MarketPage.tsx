import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { Footer } from "@/components/layout/Footer";

interface Offering {
  id: string;
  logicalModel: string;
  supplierName: string;
  supplierHandle: string;
  type: "official" | "distributed";
  online: boolean;
  votes: number;
  favorites: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
}

interface MarketResponse {
  data: Offering[];
  total: number;
  page: number;
  limit: number;
}

type SortKey = "hot" | "newest" | "stable" | "cheapest";

export function MarketPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Filters
  const [sort, setSort] = useState<SortKey>("hot");
  const [typeFilter, setTypeFilter] = useState<"all" | "official" | "distributed">("all");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sort,
    });
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (onlineOnly) params.set("online", "true");
    if (search.trim()) params.set("q", search.trim());

    apiJson<MarketResponse>(`/v1/market/offerings?${params}`)
      .then((res) => {
        setOfferings(res.data ?? []);
        setTotal(res.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, sort, typeFilter, onlineOnly, search]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen flex flex-col pt-14">
      <section className="pt-16 pb-8 px-6 text-center">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">{t("market.title")}</h1>
        <p className="text-text-secondary text-base max-w-xl mx-auto">{t("market.subtitle")}</p>
      </section>

      {/* Filter bar */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-6 w-full">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Sort buttons */}
            {(["hot", "newest", "stable", "cheapest"] as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => { setSort(key); setPage(1); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer border ${
                  sort === key ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {t(`market.sort.${key}`)}
              </button>
            ))}

            {/* Type filter */}
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value as typeof typeFilter); setPage(1); }}
              className="rounded-[var(--radius-input)] border border-line px-3 py-1 text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
              style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
            >
              <option value="all">{t("market.filter.all")}</option>
              <option value="official">{t("market.filter.official")}</option>
              <option value="distributed">{t("market.filter.distributed")}</option>
            </select>

            {/* Online toggle */}
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={onlineOnly}
                onChange={(e) => { setOnlineOnly(e.target.checked); setPage(1); }}
                className="accent-[var(--color-accent)] w-3.5 h-3.5"
              />
              {t("market.filter.onlineOnly")}
            </label>
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("market.search")}
            className="rounded-[var(--radius-input)] border border-line px-3 py-1.5 text-sm text-text-primary w-44 focus:outline-none focus:border-accent transition-colors font-mono"
            style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
          />
        </div>
      </section>

      {/* Offerings grid */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-8 flex-1 w-full">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-[var(--radius-card)] border border-line bg-panel p-5 animate-pulse">
                <div className="h-4 bg-line rounded w-2/3 mb-3" />
                <div className="h-3 bg-line rounded w-1/2 mb-2" />
                <div className="h-2 bg-line rounded w-full" />
              </div>
            ))}
          </div>
        ) : offerings.length === 0 ? (
          <div className="text-center text-text-tertiary py-20">{t("market.empty")}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {offerings.map((o) => (
              <div
                key={o.id}
                onClick={() => navigate(`/market/${encodeURIComponent(o.id)}`)}
                className="rounded-[var(--radius-card)] border border-line bg-panel p-5 transition-colors hover:border-accent/25 cursor-pointer"
              >
                {/* Model name + status */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-mono font-medium text-text-primary truncate mr-2">{o.logicalModel}</span>
                  <span className="relative flex h-2 w-2 shrink-0">
                    {o.online && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${o.online ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
                  </span>
                </div>

                {/* Supplier + badge */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-text-secondary truncate">{o.supplierName}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    o.type === "official"
                      ? "bg-accent/10 text-accent"
                      : "bg-purple-500/10 text-purple-400"
                  }`}>
                    {o.type === "official" ? t("market.badge.official") : t("market.badge.distributed")}
                  </span>
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between text-xs text-text-tertiary">
                  <div className="flex items-center gap-3">
                    <span>{o.votes} {t("market.votes")}</span>
                    <span>{o.favorites} {t("market.favs")}</span>
                  </div>
                  <span className="font-mono">{o.inputPricePer1k}/{o.outputPricePer1k} /1K</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-xs text-text-secondary hover:border-accent/30 cursor-pointer bg-transparent disabled:opacity-40 transition-colors"
            >
              {t("market.prev")}
            </button>
            <span className="text-xs text-text-tertiary">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-xs text-text-secondary hover:border-accent/30 cursor-pointer bg-transparent disabled:opacity-40 transition-colors"
            >
              {t("market.next")}
            </button>
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
