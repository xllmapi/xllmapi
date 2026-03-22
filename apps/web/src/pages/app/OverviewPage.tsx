import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { formatNumber, formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { StatCard } from "@/components/ui/StatCard";
import { ContributionGraph } from "@/components/ui/ContributionGraph";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface UsageSummary {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
  realModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
}

interface DailyData {
  date: string;
  totalTokens: number;
  requestCount: number;
}

type ViewMode = "requests" | "models";

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
    ])
      .then(([meRes, walletRes, supplyRes, consumptionRes, offeringsRes, recentRes]) => {
        setMe(meRes.data);
        setWallet(walletRes.data?.balance ?? 0);
        setSupplyUsage(supplyRes.data?.summary ?? null);
        setConsumptionUsage(consumptionRes.data?.summary ?? null);
        const items = consumptionRes.data?.items ?? [];
        setConsumptionItems(items);
        setActiveModels(items.map((i: ConsumptionItem) => i.logicalModel));
        setOfferingCount(offeringsRes.data?.length ?? 0);
        setRecentRequests(recentRes.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load heatmap data when year changes
  useEffect(() => {
    apiJson<{ data: DailyData[] }>(`/v1/usage/consumption/daily?year=${selectedYear}`)
      .then((res) => {
        const map: Record<string, number> = {};
        for (const d of res.data ?? []) {
          map[d.date] = d.totalTokens;
        }
        setHeatmapData(map);
      })
      .catch(() => {});
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

  // Filtered data
  const filteredRequests = recentRequests.filter((r) => {
    if (selectedDate && r.createdAt.slice(0, 10) !== selectedDate) return false;
    if (selectedModel && r.logicalModel !== selectedModel) return false;
    return true;
  });

  const filteredModels = consumptionItems.filter((r) => {
    if (selectedModel && r.logicalModel !== selectedModel) return false;
    return true;
  });

  if (loading) {
    return <p className="text-text-secondary py-8">{t("common.loading")}</p>;
  }

  const requestColumns: Column<RequestRecord>[] = [
    {
      key: "createdAt",
      header: t("overview.time"),
      className: "text-xs text-text-tertiary whitespace-nowrap",
      render: (r) => {
        const d = r.createdAt;
        return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
      },
    },
    {
      key: "logicalModel",
      header: t("overview.model"),
      className: "font-mono text-xs",
    },
    {
      key: "totalTokens",
      header: "xtokens",
      align: "right",
      render: (r) => formatTokens(r.totalTokens),
    },
    {
      key: "inputTokens",
      header: "Input",
      align: "right",
      render: (r) => formatTokens(r.inputTokens),
    },
    {
      key: "outputTokens",
      header: "Output",
      align: "right",
      render: (r) => formatTokens(r.outputTokens),
    },
    {
      key: "provider",
      header: "Provider",
      className: "text-xs text-text-tertiary",
    },
  ];

  const modelColumns: Column<ConsumptionItem>[] = [
    {
      key: "lastUsedAt",
      header: t("overview.lastUsed"),
      className: "text-xs text-text-tertiary",
      render: (r) => r.lastUsedAt?.slice(0, 10) ?? "—",
    },
    {
      key: "logicalModel",
      header: t("overview.model"),
      className: "font-mono text-xs",
    },
    {
      key: "totalTokens",
      header: "xtokens",
      align: "right",
      render: (r) => formatTokens(r.totalTokens),
    },
    {
      key: "requestCount",
      header: t("overview.requests"),
      align: "right",
      render: (r) => formatNumber(r.requestCount),
    },
    {
      key: "inputTokens",
      header: "Input",
      align: "right",
      render: (r) => formatTokens(r.inputTokens),
    },
    {
      key: "outputTokens",
      header: "Output",
      align: "right",
      render: (r) => formatTokens(r.outputTokens),
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={t("overview.balance")}
          value={`${formatTokens(wallet)} xtokens`}
        />
        <StatCard
          label={t("overview.supply")}
          value={`${formatTokens(supplyUsage?.totalTokens ?? 0)} xtokens`}
        />
        <StatCard
          label={t("overview.consumed")}
          value={`${formatTokens(consumptionUsage?.totalTokens ?? 0)} xtokens`}
        />
        <StatCard
          label={t("overview.offerings")}
          value={String(offeringCount)}
        />
      </div>

      {/* Contribution heatmap */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-8">
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
      <div className="flex items-center justify-between mb-3">
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
          {viewMode === "requests"
            ? `${filteredRequests.length} requests`
            : `${filteredModels.length} models`
          }
        </span>
      </div>

      {viewMode === "requests" ? (
        <DataTable
          columns={requestColumns}
          data={filteredRequests}
          rowKey={(r) => r.requestId}
          emptyText={t("overview.noRecords")}
        />
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
