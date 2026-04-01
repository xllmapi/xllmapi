import { Fragment, type ReactNode } from "react";

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
  onRowClick?: (row: T) => void;
  activeRowKey?: string | null;
  renderExpanded?: (row: T) => ReactNode | null;
  loading?: boolean;
  skeletonRows?: number;
}

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr className="border-b border-line/50">
      {Array.from({ length: colCount }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-line/30 animate-pulse" style={{ width: `${60 + (i * 17) % 30}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({ columns, data, rowKey, emptyText, rowClassName, onRowClick, activeRowKey, renderExpanded, loading, skeletonRows = 5 }: DataTableProps<T>) {
  if (loading) {
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
                  } ${col.className ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: skeletonRows }, (_, i) => (
              <SkeletonRow key={i} colCount={columns.length} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

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
                } ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const key = rowKey(row);
            const isActive = activeRowKey === key;
            const expanded = renderExpanded?.(row);
            return (
              <Fragment key={key}>
                <tr
                  className={`border-b border-line/50 transition-colors ${
                    onRowClick ? "cursor-pointer" : ""
                  } ${isActive ? "bg-accent-bg/20" : "hover:bg-accent-bg/30"} ${rowClassName?.(row) ?? ""}`}
                  onClick={() => onRowClick?.(row)}
                >
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
                {expanded && (
                  <tr className="border-b border-line/50">
                    <td colSpan={columns.length} className="p-0">
                      {expanded}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
