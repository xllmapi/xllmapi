import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";
import { FormInput } from "@/components/ui/FormInput";

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  module?: string;
  raw: string;
}

type LevelFilter = "" | "info" | "warn" | "error";

const LEVEL_COLORS: Record<string, string> = {
  error: "text-red-400",
  fatal: "text-red-500 font-bold",
  warn: "text-amber-300",
  info: "text-text-secondary",
  debug: "text-text-tertiary",
};

export function AdminLogsPage() {
  const { t } = useLocale();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<LevelFilter>("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(200);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (level) params.set("level", level);
    if (search) params.set("search", search);
    apiJson<{ data: LogEntry[] }>(`/v1/admin/logs?${params}`)
      .then((r) => setLogs(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit, level, search]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const levels: { key: LevelFilter; label: string }[] = [
    { key: "", label: t("admin.logs.all") },
    { key: "info", label: "INFO" },
    { key: "warn", label: "WARN" },
    { key: "error", label: "ERROR" },
  ];

  const limits = [100, 200, 500];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.logs.title")}</h1>
        <FormButton variant="ghost" onClick={load} className="!px-3 !py-1.5 !text-xs">
          {t("admin.nodeHealth.refresh")}
        </FormButton>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 bg-bg-1/50 rounded-lg p-0.5">
          {limits.map((l) => (
            <button
              key={l}
              onClick={() => setLimit(l)}
              className={`px-2 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                limit === l ? "bg-panel text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-bg-1/50 rounded-lg p-0.5">
          {levels.map((l) => (
            <button
              key={l.key}
              onClick={() => setLevel(l.key)}
              className={`px-2 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                level === l.key ? "bg-panel text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <FormInput
          placeholder={t("admin.logs.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="!w-48"
        />
      </div>

      {loading ? (
        <p className="text-text-secondary py-8">{t("common.loading")}</p>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-line bg-panel overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-[rgba(16,21,34,0.95)]">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left font-medium text-text-secondary w-[160px]">{t("admin.logs.time")}</th>
                  <th className="px-3 py-2 text-left font-medium text-text-secondary w-[60px]">{t("admin.logs.level")}</th>
                  <th className="px-3 py-2 text-left font-medium text-text-secondary">{t("admin.logs.message")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={i} className={`border-b border-line/30 ${log.level === "error" || log.level === "fatal" ? "bg-red-500/5" : log.level === "warn" ? "bg-amber-500/5" : ""}`}>
                    <td className="px-3 py-1.5 text-text-tertiary whitespace-nowrap align-top">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : ""}
                    </td>
                    <td className={`px-3 py-1.5 uppercase align-top ${LEVEL_COLORS[log.level] ?? "text-text-tertiary"}`}>
                      {log.level}
                    </td>
                    <td className="px-3 py-1.5 text-text-primary break-all whitespace-pre-wrap">
                      {log.module ? <span className="text-accent/60">[{log.module}] </span> : null}
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && (
              <p className="text-text-tertiary text-sm text-center py-8">{t("common.empty")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
