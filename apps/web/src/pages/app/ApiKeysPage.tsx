import { useEffect, useState, useCallback } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ApiKeyRecord {
  id: string;
  label: string;
  keyPrefix: string;
  status: string;
  createdAt: string;
}

interface CredentialOffering {
  id: string;
  logicalModel: string;
  enabled: boolean;
  archivedAt: string | null;
}

interface ProviderCredential {
  id: string;
  providerType: string;
  baseUrl: string;
  apiKeyPreview: string;
  status: string;
  displayLabel: string;
  providerLabel: string;
  offeringCount: number;
  offerings: CredentialOffering[] | null;
  createdAt: string;
}

const MAX_API_KEYS = 5;

export function ApiKeysPage() {
  const { t } = useLocale();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [credLoading, setCredLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Expanded credential rows
  const [expandedCredId, setExpandedCredId] = useState<string | null>(null);
  // Test state per credential
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await apiJson<{ data: ProviderCredential[] }>("/v1/provider-credentials");
      setCredentials(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setCredLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    fetchCredentials();
  }, [fetchKeys, fetchCredentials]);

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

  const handleTestCredential = async (credId: string) => {
    setTestingId(credId);
    setTestResult((prev) => {
      const next = { ...prev };
      delete next[credId];
      return next;
    });
    try {
      const res = await apiJson<{ ok: boolean; data: { ok: boolean; status?: string; message?: string } }>(
        `/v1/provider-credentials/${credId}/test`,
        { method: "POST" },
      );
      if (res.data?.ok !== false) {
        setTestResult((prev) => ({ ...prev, [credId]: { ok: true, message: t("apiKeys.testOk") } }));
      } else {
        setTestResult((prev) => ({ ...prev, [credId]: { ok: false, message: res.data?.message ?? t("apiKeys.testFail") } }));
      }
      fetchCredentials();
    } catch (err: unknown) {
      setTestResult((prev) => ({ ...prev, [credId]: { ok: false, message: t("apiKeys.testFail") + ": " + extractError(err) } }));
    } finally {
      setTestingId(null);
    }
  };

  const executeDeleteCredential = async (credId: string) => {
    try {
      await apiJson(`/v1/provider-credentials/${credId}?cascade=true`, { method: "DELETE" });
      fetchCredentials();
    } catch (err: unknown) {
      setError(extractError(err));
    }
  };

  const credentialStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">{t("apiKeys.active")}</Badge>;
      case "disabled":
        return <Badge variant="default">{t("modelsMgmt.status.stopped")}</Badge>;
      case "deleted":
        return <Badge variant="danger">{t("apiKeys.statusDeleted")}</Badge>;
      case "invalid":
        return <Badge variant="danger">{t("apiKeys.invalid")}</Badge>;
      case "quota_exceeded":
        return <Badge variant="warning">{t("apiKeys.quotaExceeded")}</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
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

      {/* ── Section 1: Platform API Keys ── */}
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
          <FormButton type="submit" disabled={creating || keys.length >= MAX_API_KEYS} className="shrink-0">
            {creating ? t("apiKeys.creating") : `${t("apiKeys.create")} (${keys.length}/${MAX_API_KEYS})`}
          </FormButton>
        </form>
      </div>

      {/* Platform API key list */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel mb-8">
        {loading ? (
          <div className="p-6 text-sm text-text-tertiary">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-sm text-text-tertiary">{t("apiKeys.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-text-tertiary text-xs">
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Key</th>
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.status")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.createdAt")}</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {k.id.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-tertiary">
                    xk-…{k.keyPrefix.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="success">{t("apiKeys.active")}</Badge>
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

      {/* ── Section 2: Model Node Keys (Provider Credentials) ── */}
      <h2 className="text-base font-semibold mb-1 tracking-tight">{t("apiKeys.nodeKeys")}</h2>
      <p className="text-sm text-text-secondary mb-4">{t("apiKeys.nodeKeysDesc")}</p>

      <div className="rounded-[var(--radius-card)] border border-line bg-panel">
        {credLoading ? (
          <div className="p-6 text-sm text-text-tertiary">Loading…</div>
        ) : credentials.length === 0 ? (
          <div className="p-6 text-sm text-text-tertiary">{t("apiKeys.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-text-tertiary text-xs">
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Key</th>
                <th className="text-left px-4 py-3 font-medium">Provider</th>
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.status")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("apiKeys.createdAt")}</th>
                <th className="text-right px-4 py-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((cred) => {
                const isExpanded = expandedCredId === cred.id;
                const offerings = cred.offerings ?? [];
                const result = testResult[cred.id];

                return (
                  <CredentialRowGroup key={cred.id}>
                    <tr
                      className="border-b border-line last:border-b-0 cursor-pointer hover:bg-accent/5 transition-colors"
                      onClick={() => setExpandedCredId(isExpanded ? null : cred.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                        {cred.id.slice(0, 12)}…
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-tertiary">
                        {cred.apiKeyPreview || "***"}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-primary">
                        {cred.displayLabel}
                      </td>
                      <td className="px-4 py-3">
                        {credentialStatusBadge(cred.status)}
                      </td>
                      <td className="px-4 py-3 text-text-tertiary text-xs">
                        {new Date(cred.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => void handleTestCredential(cred.id)}
                            disabled={testingId === cred.id}
                            className="text-xs text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
                          >
                            {testingId === cred.id ? t("apiKeys.testing") : t("apiKeys.test")}
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(cred.id)}
                            className="text-xs text-danger hover:text-danger/80 transition-colors"
                          >
                            {t("apiKeys.deleteKey")}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Test result display */}
                    {result && (
                      <tr className="border-b border-line">
                        <td colSpan={6} className="px-4 py-2">
                          <span className={`text-xs font-medium ${result.ok ? "text-success" : "text-danger"}`}>
                            {result.message}
                          </span>
                        </td>
                      </tr>
                    )}

                    {/* Expanded: linked offerings */}
                    {isExpanded && offerings.length > 0 && (
                      <tr className="border-b border-line bg-bg-primary/30">
                        <td colSpan={6} className="px-4 py-3">
                          <p className="text-xs font-medium text-text-secondary mb-2">
                            {t("modelsMgmt.myOfferings")}:
                          </p>
                          <div className="flex flex-col gap-1 pl-2">
                            {offerings.map((o) => {
                              const isArchived = !!o.archivedAt;
                              return (
                                <div key={o.id} className="flex items-center gap-2 text-xs">
                                  <span className="text-text-tertiary">-</span>
                                  <span className={`font-mono ${isArchived ? "text-text-tertiary line-through" : "text-text-primary"}`}>
                                    {o.logicalModel}
                                  </span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                    o.enabled && !isArchived
                                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                      : "bg-panel border-line text-text-tertiary"
                                  }`}>
                                    {o.enabled && !isArchived ? t("modelsMgmt.status.running") : t("modelsMgmt.status.stopped")}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </CredentialRowGroup>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) void executeDeleteCredential(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        title={t("apiKeys.deleteKeyTitle")}
        description={t("apiKeys.deleteKeyWarning")}
        countdown={5}
      />
    </div>
  );
}

// Wrapper to allow multiple <tr> per credential in <tbody>
function CredentialRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    return (err as { error: { message: string } }).error.message;
  }
  return "Something went wrong";
}
