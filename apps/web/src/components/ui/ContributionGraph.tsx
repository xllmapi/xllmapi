import { useMemo } from "react";

interface ContributionGraphProps {
  data: Record<string, number>;
  weeks?: number;
}

const DAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const LEVELS = [0, 0.2, 0.4, 0.6, 0.9];

function getLevel(value: number, max: number): number {
  if (value === 0 || max === 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function ContributionGraph({ data, weeks = 20 }: ContributionGraphProps) {
  const { grid, maxVal } = useMemo(() => {
    const today = new Date();
    const totalDays = weeks * 7;
    const cells: { date: string; value: number; dayOfWeek: number }[] = [];

    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
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

    for (const cell of cells) {
      grid[cell.dayOfWeek]!.push({ date: cell.date, value: cell.value });
    }

    return { grid, maxVal: mx };
  }, [data, weeks]);

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-1">
        <div className="flex flex-col gap-1 mr-1">
          {DAYS.map((d, i) => (
            <div key={i} className="h-3 text-[10px] leading-3 text-text-tertiary flex items-center">
              {d}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {Array.from({ length: Math.ceil((grid[0] ?? []).length) }, (_, weekIdx) => (
            <div key={weekIdx} className="flex flex-col gap-[3px]">
              {grid.map((dayRow, dayIdx) => {
                const cell = dayRow[weekIdx];
                if (!cell) return <div key={dayIdx} className="w-3 h-3" />;
                const level = getLevel(cell.value, maxVal);
                return (
                  <div
                    key={dayIdx}
                    className="w-3 h-3 rounded-sm"
                    style={{
                      backgroundColor:
                        level === 0
                          ? "rgba(136,154,196,0.06)"
                          : `rgba(139,227,218,${LEVELS[level]})`,
                    }}
                    title={`${cell.date}: ${cell.value} tokens`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
