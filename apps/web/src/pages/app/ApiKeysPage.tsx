import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

interface ApiKeyRecord {
  id: string;
  label: string;
  keyPrefix: string;
  status: string;
  createdAt: string;
}

export function ApiKeysPage() {
  const { t } = useLocale();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const fetchKeys = useCallback(async () => {
    try {
      const res = await apiJson<{ data: ApiKeyRecord[] }>("/v1/me/api-keys");
      setKeys(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await apiJson<{ data: { id: string; rawKey: string } }>("/v1/me/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: label || "API Key" }),
      });
      setNewKey(res.data.rawKey);
      setLabel("");
      fetchKeys();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm(t("apiKeys.revokeConfirm"))) return;
    try {
      await apiJson(`/v1/me/api-keys/${keyId}`, { method: "DELETE" });
      fetchKeys();
    } catch {
      // ignore
    }
  };

  const handleCopy = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 tracking-tight">{t("apiKeys.title")}</h1>
      <p className="text-sm text-text-secondary mb-6">{t("apiKeys.description")}</p>

      {error && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      {/* New key display */}
      {newKey && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-success/30 bg-success/5 p-4">
          <p className="text-sm text-success font-medium mb-2">{t("apiKeys.created")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-bg-primary border border-line rounded px-3 py-2 font-mono break-all select-all">
              {newKey}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 px-3 py-2 text-xs rounded bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              {copied ? t("apiKeys.copied") : t("apiKeys.copy")}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs text-text-tertiary hover:text-text-secondary"
          >
            {t("apiKeys.close")}
          </button>
        </div>
      )}

      {/* Create form */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-6">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("apiKeys.create")}</h2>
        <form onSubmit={handleCreate} className="flex items-end gap-3">
          <div className="flex-1 max-w-sm">
            <label className="block text-xs text-text-secondary mb-1">{t("apiKeys.label")}</label>
            <FormInput
              placeholder={t("apiKeys.labelPlaceholder")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <FormButton type="submit" disabled={creating} className="shrink-0">
            {creating ? t("apiKeys.creating") : t("apiKeys.create")}
          </FormButton>
        </form>
      </div>

      {/* Key list */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel">
        {loading ? (
          <div className="p-6 text-sm text-text-tertiary">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-sm text-text-tertiary">{t("apiKeys.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-text-tertiary text-xs">
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.label")}</th>
                <th className="text-left px-4 py-3 font-medium">Key</th>
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.status")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.createdAt")}</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3 font-medium">{k.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-text-tertiary">
                    xk-…{k.keyPrefix.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-success/10 text-success">
                      {t("apiKeys.active")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-tertiary text-xs">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(k.id)}
                      className="text-xs text-danger hover:text-danger/80 transition-colors"
                    >
                      {t("apiKeys.revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
