import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { formatTokens, formatProviderType } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
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

interface RequestRecord {
  requestId: string;
  logicalModel: string;
  provider: string;
  providerLabel?: string;
  realModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
  consumerCost?: number;
  supplierReward?: number;
}

interface DailyData {
  date: string;
  totalTokens: number;
  requestCount: number;
}

type ViewMode = "requests" | "models";

interface MergedRecord {
  id: string;
  type: "consume" | "supply";
  logicalModel: string;
  provider?: string;
  providerLabel?: string;
  realModel?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt?: string;
  consumerCost?: number;
  supplierReward?: number;
}

export function OverviewPage() {
  const { t } = useLocale();
  const currentYear = new Date().getFullYear();

  // Core data
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [wallet, setWallet] = useState(0);
  const [supplyUsage, setSupplyUsage] = useState<UsageSummary | null>(null);
  const [consumptionUsage, setConsumptionUsage] = useState<UsageSummary | null>(null);
  const [consumptionItems, setConsumptionItems] = useState<ConsumptionItem[]>([]);
  const [recentRequests, setRecentRequests] = useState<RequestRecord[]>([]);
  const [supplyRecent, setSupplyRecent] = useState<RequestRecord[]>([]);
  const [supplyModelItems, setSupplyModelItems] = useState<ConsumptionItem[]>([]);
  const [offeringCount, setOfferingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Heatmap
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});
  const [activeModels, setActiveModels] = useState<string[]>([]);

  // Filter
  const [viewMode, setViewMode] = useState<ViewMode>("requests");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // supply always included in merged list

  const availableYears = Array.from(
    { length: currentYear - 2024 + 1 },
    (_, i) => 2024 + i
  );

  // Load initial data
  useEffect(() => {
    Promise.all([
      apiJson<{ data: { displayName: string } }>("/v1/me"),
      apiJson<{ data: { balance: number } }>("/v1/wallet"),
      apiJson<{ data: { summary: UsageSummary; items: ConsumptionItem[] } }>("/v1/usage/supply"),
      apiJson<{ data: { summary: UsageSummary; items: ConsumptionItem[] } }>("/v1/usage/consumption"),
      apiJson<{ data: unknown[] }>("/v1/offerings"),
      apiJson<{ data: RequestRecord[] }>("/v1/usage/consumption/recent?days=30"),
      apiJson<{ data: RequestRecord[] }>("/v1/usage/supply/recent?days=30").catch(() => ({ data: [] })),
    ])
      .then(([meRes, walletRes, supplyRes, consumptionRes, offeringsRes, recentRes, supplyRecentRes]) => {
        setMe(meRes.data);
        setWallet(walletRes.data?.balance ?? 0);
        setSupplyUsage(supplyRes.data?.summary ?? null);
        setSupplyModelItems((supplyRes.data?.items as ConsumptionItem[]) ?? []);
        setConsumptionUsage(consumptionRes.data?.summary ?? null);
        const items = consumptionRes.data?.items ?? [];
        setConsumptionItems(items);
        setActiveModels(items.map((i: ConsumptionItem) => i.logicalModel));
        setOfferingCount(offeringsRes.data?.length ?? 0);
        setRecentRequests(recentRes.data ?? []);
        setSupplyRecent((supplyRecentRes as { data: RequestRecord[] }).data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load heatmap data when year changes — net value (consume - supply)
  useEffect(() => {
    Promise.all([
      apiJson<{ data: DailyData[] }>(`/v1/usage/consumption/daily?year=${selectedYear}`),
      apiJson<{ data: DailyData[] }>(`/v1/usage/supply/daily?year=${selectedYear}`).catch(() => ({ data: [] })),
    ]).then(([consumeRes, supplyRes]) => {
      const map: Record<string, number> = {};
      // Positive = consumption
      for (const d of consumeRes.data ?? []) {
        map[d.date] = Number(d.totalTokens);
      }
      // Negative = supply income
      for (const d of supplyRes.data ?? []) {
        const existing = map[d.date] ?? 0;
        map[d.date] = existing - Number(d.totalTokens);
      }
      setHeatmapData(map);
    }).catch(() => {});
  }, [selectedYear]);

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

  // Build merged list (consume + supply when toggled)
  const mergedRecords: MergedRecord[] = recentRequests.map((r) => ({
    id: r.requestId,
    type: "consume" as const,
    logicalModel: r.logicalModel,
    provider: r.provider,
    providerLabel: r.providerLabel,
    realModel: r.realModel,
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    totalTokens: Number(r.totalTokens),
    createdAt: r.createdAt,
    consumerCost: Number(r.consumerCost ?? 0),
  }));
  {
    const consumeIds = new Set(recentRequests.map((r) => r.requestId));
    for (const s of supplyRecent) {
      if (consumeIds.has(s.requestId)) continue;
      mergedRecords.push({
        id: `supply-${s.requestId}`,
        type: "supply",
        logicalModel: s.logicalModel,
        provider: s.provider,
        providerLabel: s.providerLabel,
        realModel: s.realModel,
        inputTokens: Number(s.inputTokens),
        outputTokens: Number(s.outputTokens),
        totalTokens: Number(s.totalTokens),
        createdAt: s.createdAt,
        supplierReward: Number(s.supplierReward ?? 0),
      });
    }
    mergedRecords.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }

  // Filtered data
  const filteredRequests = mergedRecords.filter((r) => {
    if (selectedDate && r.createdAt?.slice(0, 10) !== selectedDate) return false;
    if (selectedModel && r.logicalModel !== selectedModel) return false;
    return true;
  });

  // Pagination
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const pagedRequests = filteredRequests.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [selectedDate, selectedModel]);

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

  if (loading) {
    return <p className="text-text-secondary py-8">{t("common.loading")}</p>;
  }

  const requestColumns: Column<MergedRecord>[] = [
    {
      key: "type",
      header: "",
      className: "w-2 !px-0",
      render: (r) => (
        <span className={`inline-block w-1.5 h-4 rounded-full ${r.type === "supply" ? "bg-emerald-400/60" : "bg-amber-300/50"}`} />
      ),
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
    },
    {
      key: "cost",
      header: "xtokens",
      align: "right",
      render: (r) => {
        const xt = r.type === "supply" ? (r.supplierReward ?? 0) : (r.consumerCost ?? 0);
        return <span className={r.type === "supply" ? "text-emerald-400 font-medium" : "text-amber-300 font-medium"}>{formatTokens(xt)}</span>;
      },
    },
    {
      key: "totalTokens",
      header: "Tokens",
      align: "right",
      render: (r) => <span className="text-text-tertiary">{formatTokens(r.totalTokens)}</span>,
    },
    {
      key: "inputTokens",
      header: "Input",
      align: "right",
      className: "hidden md:table-cell",
      render: (r) => <span className="text-text-tertiary">{formatTokens(r.inputTokens)}</span>,
    },
    {
      key: "outputTokens",
      header: "Output",
      align: "right",
      className: "hidden md:table-cell",
      render: (r) => <span className="text-text-tertiary">{formatTokens(r.outputTokens)}</span>,
    },
    {
      key: "provider",
      header: "Provider",
      className: "text-xs text-text-tertiary",
      render: (r) => r.type === "supply" ? t("overview.viewSupply") : formatProviderType(r.provider ?? "", r.providerLabel),
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
        />
        <StatCard
          label={t("overview.supply")}
          value={`${formatTokens(supplyUsage?.supplierReward ?? 0)} xtokens`}
        />
        <StatCard
          label={t("overview.consumed")}
          value={`${formatTokens(consumptionUsage?.consumerCost ?? 0)} xtokens`}
        />
        <StatCard
          label={t("overview.offerings")}
          value={String(offeringCount)}
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
          {viewMode === "requests" ? `${filteredRequests.length} records · ${currentPage}/${totalPages}` : `${filteredModels.length} models`}
        </span>
      </div>

      {viewMode === "requests" ? (
        <>
          <DataTable
            columns={requestColumns}
            data={pagedRequests}
            rowKey={(r) => r.id}
            emptyText={t("overview.noRecords")}
            rowClassName={(r) => r.type === "supply" ? "bg-emerald-400/5" : "bg-amber-300/3"}
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-1 text-xs rounded-[var(--radius-btn)] border border-line text-text-secondary hover:bg-accent/10 cursor-pointer bg-transparent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ←
              </button>
              <span className="text-xs text-text-tertiary">{currentPage} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
