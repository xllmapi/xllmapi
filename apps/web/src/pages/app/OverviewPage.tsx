import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { formatTokens, formatProviderType } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { StatCard } from "@/components/ui/StatCard";
import { ContributionGraph } from "@/components/ui/ContributionGraph";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface UsageSummary {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  supplierReward?: number;
  consumerCost?: number;
}

interface ConsumptionItem {
  logicalModel: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsedAt?: string;
}

interface DailyData {
  date: string;
  totalTokens: number;
  requestCount: number;
}

type ViewMode = "requests" | "models";

interface LedgerRecord {
  id: number;
  requestId: string | null;
  direction: "credit" | "debit";
  amount: string;
  entryType: string;
  note: string | null;
  createdAt: string;
  logicalModel: string | null;
  provider: string | null;
  providerLabel: string | null;
  realModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  fullCostWithoutCache: number | null;
}

export function OverviewPage() {
  const { t } = useLocale();
  const currentYear = new Date().getFullYear();

  // Core data via useCachedFetch
  const { data: meData, loading: meLoading } = useCachedFetch<{ data: { displayName: string } }>("/v1/me");
  const { data: walletData, loading: walletLoading } = useCachedFetch<{ data: { balance: number } }>("/v1/wallet");
  const { data: supplyData, loading: supplyLoading } = useCachedFetch<{ data: { summary: UsageSummary; items: ConsumptionItem[] } }>("/v1/usage/supply");
  const { data: consumptionData, loading: consumptionLoading } = useCachedFetch<{ data: { summary: UsageSummary; items: ConsumptionItem[] } }>("/v1/usage/consumption");
  const { data: offeringsData, loading: offeringsLoading } = useCachedFetch<{ data: unknown[] }>("/v1/offerings");

  const me = meData?.data ?? null;
  const wallet = walletData?.data?.balance ?? 0;
  const supplyUsage = supplyData?.data?.summary ?? null;
  const supplyModelItems = (supplyData?.data?.items as ConsumptionItem[]) ?? [];
  const consumptionUsage = consumptionData?.data?.summary ?? null;
  const consumptionItems = consumptionData?.data?.items ?? [];
  const activeModels = consumptionItems.map((i: ConsumptionItem) => i.logicalModel);
  const offeringCount = offeringsData?.data?.length ?? 0;
  const loading = meLoading || walletLoading || supplyLoading || consumptionLoading || offeringsLoading;

  // Heatmap
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});

  // Filter
  const [viewMode, setViewMode] = useState<ViewMode>("requests");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Ledger-backed records for "by date" view
  const PAGE_SIZE = 20;
  const [ledgerRecords, setLedgerRecords] = useState<LedgerRecord[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const availableYears = Array.from(
    { length: currentYear - 2024 + 1 },
    (_, i) => 2024 + i
  );

  // Load heatmap data when year changes — net value (consume - supply)
  const { data: heatmapConsumeData } = useCachedFetch<{ data: DailyData[] }>(`/v1/usage/consumption/daily?year=${selectedYear}`);
  const { data: heatmapSupplyData } = useCachedFetch<{ data: DailyData[] }>(`/v1/usage/supply/daily?year=${selectedYear}`);

  useEffect(() => {
    const map: Record<string, number> = {};
    // Positive = consumption
    for (const d of heatmapConsumeData?.data ?? []) {
      map[d.date] = Number(d.totalTokens);
    }
    // Negative = supply income
    for (const d of heatmapSupplyData?.data ?? []) {
      const existing = map[d.date] ?? 0;
      map[d.date] = existing - Number(d.totalTokens);
    }
    setHeatmapData(map);
  }, [heatmapConsumeData, heatmapSupplyData]);

  // Load ledger records for "by date" view
  const loadRecords = useCallback(async (page: number, date?: string | null, model?: string | null) => {
    setLedgerLoading(true);
    try {
      const limit = PAGE_SIZE;
      const offset = (page - 1) * limit;
      let url = `/v1/ledger?limit=${limit}&offset=${offset}`;
      if (date) url += `&date=${date}`;
      if (model) url += `&model=${encodeURIComponent(model)}`;
      const res = await apiJson<{ data: LedgerRecord[]; total: number }>(url);
      setLedgerRecords(res.data ?? []);
      setLedgerTotal(res.total ?? 0);
      setCurrentPage(page);
    } catch {
      // ignore
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords(1, selectedDate, selectedModel);
  }, [selectedDate, selectedModel, loadRecords]);

  // Handle date click on heatmap
  const handleDateClick = useCallback((date: string) => {
    if (!date || selectedDate === date) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate(date);
    setSelectedModel(null);
  }, [selectedDate]);

  // Handle model click
  const handleModelClick = useCallback((model: string) => {
    if (selectedModel === model) {
      setSelectedModel(null);
      return;
    }
    setSelectedModel(model);
    setSelectedDate(null);
  }, [selectedModel]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(ledgerTotal / PAGE_SIZE));

  // Build merged model data (consume + supply per model)
  interface MergedModelRow {
    logicalModel: string;
    cTokens: number; sTokens: number;
    cRequests: number; sRequests: number;
    cInput: number; sInput: number;
    cOutput: number; sOutput: number;
  }
  const modelMap = new Map<string, MergedModelRow>();
  for (const c of consumptionItems) {
    const key = c.logicalModel;
    const row = modelMap.get(key) ?? { logicalModel: key, cTokens: 0, sTokens: 0, cRequests: 0, sRequests: 0, cInput: 0, sInput: 0, cOutput: 0, sOutput: 0 };
    row.cTokens = Number(c.totalTokens); row.cRequests = Number(c.requestCount);
    row.cInput = Number(c.inputTokens); row.cOutput = Number(c.outputTokens);
    modelMap.set(key, row);
  }
  for (const s of supplyModelItems) {
    const key = s.logicalModel;
    const row = modelMap.get(key) ?? { logicalModel: key, cTokens: 0, sTokens: 0, cRequests: 0, sRequests: 0, cInput: 0, sInput: 0, cOutput: 0, sOutput: 0 };
    row.sTokens += Number(s.totalTokens); row.sRequests += Number(s.requestCount);
    row.sInput += Number(s.inputTokens); row.sOutput += Number(s.outputTokens);
    modelMap.set(key, row);
  }
  const mergedModels = [...modelMap.values()];

  const filteredModels = mergedModels.filter((r) => {
    if (selectedModel && r.logicalModel !== selectedModel) return false;
    return true;
  });

  const isApiEntry = (r: LedgerRecord) => r.entryType === "consumer_cost" || r.entryType === "supplier_reward";

  const requestColumns: Column<LedgerRecord>[] = [
    {
      key: "type",
      header: "",
      className: "w-2 !px-0",
      render: (r) => {
        if (!isApiEntry(r)) return <span className="inline-block w-1.5 h-4 rounded-full bg-sky-400/50" />;
        return <span className={`inline-block w-1.5 h-4 rounded-full ${r.direction === "credit" ? "bg-emerald-400/60" : "bg-amber-300/50"}`} />;
      },
    },
    {
      key: "createdAt",
      header: t("overview.time"),
      className: "text-xs text-text-tertiary whitespace-nowrap",
      render: (r) => {
        if (!r.createdAt) return "—";
        return `${r.createdAt.slice(5, 10)} ${r.createdAt.slice(11, 16)}`;
      },
    },
    {
      key: "logicalModel",
      header: t("overview.model"),
      className: "font-mono text-xs",
      render: (r) => {
        if (isApiEntry(r) && r.logicalModel) return r.logicalModel;
        return <span className="text-text-tertiary">—</span>;
      },
    },
    {
      key: "cost",
      header: "xtokens",
      align: "right",
      render: (r) => {
        const amt = Number(r.amount);
        const isCredit = r.direction === "credit";
        const fullCost = r.fullCostWithoutCache ? Number(r.fullCostWithoutCache) : 0;
        const saved = fullCost > amt ? fullCost - amt : 0;
        return (
          <span className="flex flex-col items-end leading-tight">
            <span className={isCredit ? "text-emerald-400 font-medium" : "text-amber-300 font-medium"}>
              {isCredit ? "+" : "−"}{formatTokens(amt)}
            </span>
            {!isCredit && saved > 0 && <span className="text-green-500 text-[10px] cursor-help" title={t("overview.cacheSavedTip")}>{t("overview.cacheSaved")}{formatTokens(saved)}</span>}
            {isCredit && (r.cacheReadTokens ?? 0) > 0 && <span className="text-blue-400 text-[10px]">{t("overview.cacheHit")}</span>}
          </span>
        );
      },
    },
    {
      key: "totalTokens",
      header: "Tokens",
      align: "right",
      render: (r) => <span className="text-text-tertiary">{r.totalTokens != null ? formatTokens(r.totalTokens) : "—"}</span>,
    },
    {
      key: "inputTokens",
      header: "Input",
      align: "right",
      className: "hidden md:table-cell",
      render: (r) => <span className="text-text-tertiary">{r.inputTokens != null ? formatTokens(r.inputTokens) : "—"}</span>,
    },
    {
      key: "outputTokens",
      header: "Output",
      align: "right",
      className: "hidden md:table-cell",
      render: (r) => <span className="text-text-tertiary">{r.outputTokens != null ? formatTokens(r.outputTokens) : "—"}</span>,
    },
    {
      key: "provider",
      header: "Provider",
      className: "text-xs text-text-tertiary",
      render: (r) => {
        if (isApiEntry(r)) {
          return r.direction === "credit" ? t("overview.viewSupply") : formatProviderType(r.provider ?? "", r.providerLabel);
        }
        return r.note ?? "—";
      },
    },
  ];

  const dualCell = (c: number, s: number) => (
    <span className="inline-flex items-center gap-0.5">
      <span className={c > 0 ? "text-amber-300/80" : "text-text-tertiary/30"}>{c > 0 ? formatTokens(c) : "—"}</span>
      <span className="text-text-tertiary/30">/</span>
      <span className={s > 0 ? "text-emerald-400/80" : "text-text-tertiary/30"}>{s > 0 ? formatTokens(s) : "—"}</span>
    </span>
  );

  const modelColumns: Column<MergedModelRow>[] = [
    {
      key: "logicalModel",
      header: t("overview.model"),
      className: "font-mono text-xs",
    },
    {
      key: "totalTokens",
      header: "xtokens",
      align: "right",
      render: (r) => dualCell(r.cTokens, r.sTokens),
    },
    {
      key: "requestCount",
      header: t("overview.requests"),
      align: "right",
      render: (r) => dualCell(r.cRequests, r.sRequests),
    },
    {
      key: "inputTokens",
      header: "Input",
      align: "right",
      render: (r) => dualCell(r.cInput, r.sInput),
    },
    {
      key: "outputTokens",
      header: "Output",
      align: "right",
      render: (r) => dualCell(r.cOutput, r.sOutput),
    },
  ];

  const hasFilter = !!(selectedDate || selectedModel);
  const filterLabel = selectedDate ?? selectedModel;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">
        {t("overview.welcome")}{me?.displayName ? `, ${me.displayName}` : ""}
      </h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={t("overview.balance")}
          value={`${formatTokens(wallet)} xtokens`}
          loading={loading}
        />
        <StatCard
          label={t("overview.supply")}
          value={`${formatTokens(supplyUsage?.supplierReward ?? 0)} xtokens`}
          loading={loading}
        />
        <StatCard
          label={t("overview.consumed")}
          value={`${formatTokens(consumptionUsage?.consumerCost ?? 0)} xtokens`}
          loading={loading}
        />
        <StatCard
          label={t("overview.offerings")}
          value={String(offeringCount)}
          loading={loading}
        />
      </div>

      {/* Contribution heatmap */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-3 md:p-5 mb-8 overflow-x-auto">
        <ContributionGraph
          data={heatmapData}
          weeks={52}
          selectedDate={selectedDate}
          onDateClick={handleDateClick}
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
          availableYears={availableYears}
          activeModels={activeModels}
          onModelClick={handleModelClick}
          selectedModel={selectedModel}
        />
      </div>

      {/* Detail section header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t("overview.details")}</h2>

          {/* View mode toggle */}
          <div className="flex items-center bg-panel-strong rounded-md p-0.5">
            <button
              onClick={() => setViewMode("requests")}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                viewMode === "requests"
                  ? "bg-bg-1 text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              按日期
            </button>
            <button
              onClick={() => setViewMode("models")}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                viewMode === "models"
                  ? "bg-bg-1 text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              按模型
            </button>
          </div>

          {/* Color legend */}
          <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
            <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-3 rounded-full bg-amber-300/50" />{t("overview.consumed")}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-3 rounded-full bg-emerald-400/60" />{t("overview.supply")}</span>
          </div>

          {/* Active filter badge */}
          {hasFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium">
              {selectedDate ? "📅" : "🤖"} {filterLabel}
              <button
                onClick={() => { setSelectedDate(null); setSelectedModel(null); }}
                className="ml-0.5 hover:text-white transition-colors"
              >
                ×
              </button>
            </span>
          )}
        </div>

        <span className="text-[11px] text-text-tertiary">
          {viewMode === "requests" ? `${ledgerTotal} records · ${currentPage}/${totalPages}` : `${filteredModels.length} models`}
        </span>
      </div>

      {viewMode === "requests" ? (
        <>
          {ledgerLoading ? (
            <div className="text-center py-8 text-text-tertiary text-xs">{t("common.loading")}</div>
          ) : (
            <DataTable
              columns={requestColumns}
              data={ledgerRecords}
              rowKey={(r) => String(r.id)}
              emptyText={t("overview.noRecords")}
              rowClassName={(r) => {
                if (!isApiEntry(r)) return "bg-sky-400/3";
                return r.direction === "credit" ? "bg-emerald-400/5" : "bg-amber-300/3";
              }}
            />
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => void loadRecords(currentPage - 1, selectedDate, selectedModel)}
                disabled={currentPage <= 1}
                className="px-3 py-1 text-xs rounded-[var(--radius-btn)] border border-line text-text-secondary hover:bg-accent/10 cursor-pointer bg-transparent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ←
              </button>
              <span className="text-xs text-text-tertiary">{currentPage} / {totalPages}</span>
              <button
                onClick={() => void loadRecords(currentPage + 1, selectedDate, selectedModel)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1 text-xs rounded-[var(--radius-btn)] border border-line text-text-secondary hover:bg-accent/10 cursor-pointer bg-transparent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                →
              </button>
            </div>
          )}
        </>
      ) : (
        <DataTable
          columns={modelColumns}
          data={filteredModels}
          rowKey={(r) => r.logicalModel}
          emptyText={t("overview.noRecords")}
        />
      )}
    </div>
  );
}
