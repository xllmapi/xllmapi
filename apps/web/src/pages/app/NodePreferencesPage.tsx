import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";

interface NodePreferences {
  allowDistributed: boolean;
  trustMode: "all" | "by_supplier" | "by_offering";
}

interface PoolEntry {
  id: string;
  offeringId: string;
  logicalModel: string;
  supplierName: string;
  joinedAt: string;
}

export function NodePreferencesPage() {
  const { t } = useLocale();
  const [prefs, setPrefs] = useState<NodePreferences>({ allowDistributed: true, trustMode: "all" });
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [leavingId, setLeavingId] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [prefsRes, poolRes] = await Promise.all([
        apiJson<{ data: NodePreferences }>("/v1/me/node-preferences"),
        apiJson<{ data: PoolEntry[] }>("/v1/me/connection-pool").catch(() => ({ data: [] })),
      ]);
      if (prefsRes.data) setPrefs(prefsRes.data);
      setPool(poolRes.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await apiJson("/v1/me/node-preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
      });
      setSuccess(t("nodePrefs.saved"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLeavePool = async (id: string) => {
    setLeavingId(id);
    try {
      await apiJson(`/v1/me/connection-pool/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLeavingId("");
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("nodePrefs.title")}</h1>

      {error && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-success/10 border border-success/30 px-4 py-2.5 text-sm text-success">
          {success}
        </div>
      )}

      {/* Preferences */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("nodePrefs.settings")}</h2>

        {/* Global toggle */}
        <div className="flex items-center justify-between py-3 border-b border-line">
          <div>
            <p className="text-sm text-text-primary font-medium">{t("nodePrefs.allowDistributed")}</p>
            <p className="text-xs text-text-tertiary mt-0.5">{t("nodePrefs.allowDistributedDesc")}</p>
          </div>
          <button
            onClick={() => setPrefs((p) => ({ ...p, allowDistributed: !p.allowDistributed }))}
            className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer border-none ${
              prefs.allowDistributed ? "bg-accent" : "bg-line"
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              prefs.allowDistributed ? "translate-x-5.5" : "translate-x-0.5"
            }`} />
          </button>
        </div>

        {/* Trust mode */}
        {prefs.allowDistributed && (
          <div className="py-3">
            <p className="text-sm text-text-primary font-medium mb-2">{t("nodePrefs.trustMode")}</p>
            <div className="flex flex-col gap-2">
              {(["all", "by_supplier", "by_offering"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="trustMode"
                    checked={prefs.trustMode === mode}
                    onChange={() => setPrefs((p) => ({ ...p, trustMode: mode }))}
                    className="accent-[var(--color-accent)] w-4 h-4"
                  />
                  <div>
                    <span className="text-sm text-text-primary">{t(`nodePrefs.trust.${mode}`)}</span>
                    <p className="text-xs text-text-tertiary">{t(`nodePrefs.trust.${mode}.desc`)}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <FormButton onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("nodePrefs.saving") : t("nodePrefs.save")}
          </FormButton>
        </div>
      </div>

      {/* Connection pool */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("nodePrefs.connectionPool")}</h2>
        {pool.length === 0 ? (
          <p className="text-text-tertiary text-sm">{t("nodePrefs.noPool")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {pool.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-4 rounded-[var(--radius-input)] border border-line px-4 py-3">
                <div className="min-w-0">
                  <span className="font-mono text-sm text-text-primary">{entry.logicalModel}</span>
                  <span className="text-xs text-text-tertiary ml-2">{entry.supplierName}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-text-tertiary">{new Date(entry.joinedAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => void handleLeavePool(entry.id)}
                    disabled={leavingId === entry.id}
                    className="rounded-[var(--radius-btn)] border border-danger/30 text-danger px-3 py-1 text-xs font-medium hover:bg-danger/10 cursor-pointer bg-transparent transition-colors disabled:opacity-50"
                  >
                    {leavingId === entry.id ? "..." : t("nodePrefs.leave")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    return (err as { error: { message: string } }).error.message;
  }
  return "Something went wrong";
}
