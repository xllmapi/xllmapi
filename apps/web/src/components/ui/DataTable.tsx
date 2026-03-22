import { type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyText?: string;
  rowClassName?: (row: T) => string;
}

export function DataTable<T>({ columns, data, rowKey, emptyText, rowClassName }: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-panel px-6 py-12 text-center">
        <p className="text-text-tertiary text-sm">{emptyText ?? "No data"}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-[rgba(16,21,34,0.5)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-medium text-text-secondary text-xs ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={rowKey(row)} className={`border-b border-line/50 last:border-b-0 hover:bg-accent-bg/30 transition-colors ${rowClassName?.(row) ?? ""}`}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 ${col.align === "right" ? "text-right" : ""} ${col.className ?? ""}`}
                >
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
