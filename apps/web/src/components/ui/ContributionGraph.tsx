import { useMemo } from "react";

interface ContributionGraphProps {
  data: Record<string, number>;
  weeks?: number;
  selectedDate?: string | null;
  onDateClick?: (date: string) => void;
  selectedYear: number;
  onYearChange: (year: number) => void;
  availableYears: number[];
  activeModels?: string[];
  onModelClick?: (model: string) => void;
  selectedModel?: string | null;
}

const DAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVELS = [0, 0.2, 0.4, 0.6, 0.9];

const MODEL_ICONS: Record<string, { label: string; color: string }> = {
  "deepseek-chat": { label: "DS", color: "#4d9de0" },
  "gpt-4o-mini": { label: "GP", color: "#10a37f" },
  "gpt-4o": { label: "G4", color: "#10a37f" },
  "claude-sonnet-4-20250514": { label: "CL", color: "#d4a574" },
  "claude-haiku-3-20240307": { label: "CH", color: "#d4a574" },
};

function getLevel(value: number, max: number): number {
  if (value === 0 || max === 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ContributionGraph({
  data,
  weeks = 52,
  selectedDate,
  onDateClick,
  selectedYear,
  onYearChange,
  availableYears,
  activeModels = [],
  onModelClick,
  selectedModel,
}: ContributionGraphProps) {
  const { grid, maxVal, monthLabels } = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    let endDate: Date;
    let startDate: Date;

    if (selectedYear === currentYear) {
      endDate = today;
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - weeks * 7 + 1);
    } else {
      endDate = new Date(selectedYear, 11, 31);
      startDate = new Date(selectedYear, 0, 1);
    }

    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    const cells: { date: string; value: number; dayOfWeek: number }[] = [];

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      cells.push({
        date: key,
        value: data[key] ?? 0,
        dayOfWeek: (d.getDay() + 6) % 7,
      });
    }

    let mx = 0;
    for (const c of cells) {
      if (c.value > mx) mx = c.value;
    }

    const grid: { date: string; value: number }[][] = Array.from(
      { length: 7 },
      () => [],
    );

    // Pad leading empty cells for first week alignment
    if (cells.length > 0) {
      const firstDow = cells[0]!.dayOfWeek;
      for (let i = 0; i < firstDow; i++) {
        grid[i]!.push({ date: "", value: -1 });
      }
    }

    for (const cell of cells) {
      grid[cell.dayOfWeek]!.push({ date: cell.date, value: cell.value });
    }

    // Month labels
    const weekCount = Math.max(...grid.map((r) => r.length));
    const monthLabels: { label: string; weekIdx: number }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weekCount; w++) {
      const mondayCell = grid[0]?.[w];
      if (mondayCell && mondayCell.date) {
        const month = parseInt(mondayCell.date.slice(5, 7), 10) - 1;
        if (month !== lastMonth) {
          monthLabels.push({ label: MONTHS[month] ?? "", weekIdx: w });
          lastMonth = month;
        }
      }
    }

    return { grid, maxVal: mx, monthLabels };
  }, [data, weeks, selectedYear]);

  const weekCount = Math.max(...grid.map((r) => r.length));

  return (
    <div>
      {/* Header: year selector */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          {availableYears.map((y) => (
            <button
              key={y}
              onClick={() => onYearChange(y)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                y === selectedYear
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-panel-strong"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        {selectedDate && (
          <button
            onClick={() => onDateClick?.("")}
            className="text-[10px] text-text-tertiary hover:text-accent transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Month labels */}
      <div className="overflow-x-auto">
        <div className="inline-block">
          <div className="flex ml-[28px] mb-1">
            {Array.from({ length: weekCount }, (_, w) => {
              const label = monthLabels.find((m) => m.weekIdx === w);
              return (
                <div key={w} className="text-[10px] text-text-tertiary" style={{ width: 15 }}>
                  {label?.label ?? ""}
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div className="inline-flex gap-1">
            <div className="flex flex-col gap-1 mr-1">
              {DAYS.map((d, i) => (
                <div key={i} className="h-3 text-[10px] leading-3 text-text-tertiary flex items-center">
                  {d}
                </div>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {Array.from({ length: weekCount }, (_, weekIdx) => (
                <div key={weekIdx} className="flex flex-col gap-[3px]">
                  {grid.map((dayRow, dayIdx) => {
                    const cell = dayRow[weekIdx];
                    if (!cell || cell.value === -1) return <div key={dayIdx} className="w-3 h-3" />;
                    const level = getLevel(cell.value, maxVal);
                    const isSelected = selectedDate === cell.date;
                    return (
                      <div
                        key={dayIdx}
                        className={`w-3 h-3 rounded-sm cursor-pointer transition-all ${
                          isSelected ? "ring-1 ring-accent ring-offset-1 ring-offset-bg-0" : ""
                        }`}
                        style={{
                          backgroundColor:
                            level === 0
                              ? "rgba(136,154,196,0.06)"
                              : `rgba(139,227,218,${LEVELS[level]})`,
                        }}
                        title={`${cell.date}: ${formatTokens(cell.value)} xtokens`}
                        onClick={() => cell.date && onDateClick?.(cell.date)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend + Model icons */}
      <div className="flex items-center justify-between mt-3">
        {/* Model icons */}
        <div className="flex items-center gap-2">
          {activeModels.map((model) => {
            const icon = MODEL_ICONS[model] ?? { label: model.slice(0, 2).toUpperCase(), color: "#8be3da" };
            const isActive = selectedModel === model;
            return (
              <button
                key={model}
                onClick={() => onModelClick?.(model)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors ${
                  isActive
                    ? "bg-accent/15 text-accent font-semibold"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-panel-strong"
                }`}
                title={model}
              >
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold"
                  style={{ backgroundColor: icon.color + "30", color: icon.color }}
                >
                  {icon.label}
                </span>
                <span className="hidden sm:inline">{model}</span>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className="w-3 h-3 rounded-sm"
              style={{
                backgroundColor:
                  level === 0
                    ? "rgba(136,154,196,0.06)"
                    : `rgba(139,227,218,${LEVELS[level]})`,
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
