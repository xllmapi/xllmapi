import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge } from "@/components/ui/Badge";

interface NodeToken {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  token?: string;
}

interface ConnectedNode {
  id: string;
  tokenId: string;
  status: string;
  lastHeartbeat: string;
  ip: string;
  modelsCount: number;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NodesPage() {
  const { t } = useLocale();
  const [tokens, setTokens] = useState<NodeToken[]>([]);
  const [nodes, setNodes] = useState<ConnectedNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create token form
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState("");
  const [revokingId, setRevokingId] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [tokensRes, nodesRes] = await Promise.all([
        apiJson<{ data: NodeToken[] }>("/v1/nodes/tokens"),
        apiJson<{ data: ConnectedNode[] }>("/v1/nodes"),
      ]);
      setTokens(tokensRes.data ?? []);
      setNodes(nodesRes.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setNewTokenValue("");
    setCreating(true);
    try {
      const res = await apiJson<{ data: { id: string; token: string } }>("/v1/nodes/tokens", {
        method: "POST",
        body: JSON.stringify({ label: newLabel.trim() || "default" }),
      });
      setNewTokenValue(res.data?.token ?? "");
      setSuccess(t("nodes.tokenCreated"));
      setNewLabel("");
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setError("");
    try {
      await apiJson(`/v1/nodes/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadData();
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setRevokingId("");
    }
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  const onlineNodes = nodes.filter((n) => n.status === "online");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("nodes.title")}</h1>

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

      {/* Newly created token display */}
      {newTokenValue && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-accent/30 bg-accent/5 p-5">
          <p className="text-sm text-text-secondary mb-2">{t("nodes.copyTokenWarning")}</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-sm text-text-primary bg-bg-0/50 rounded-[var(--radius-input)] px-3 py-2 overflow-hidden text-ellipsis select-all">
              {newTokenValue}
            </code>
            <CopyButton text={newTokenValue} />
          </div>
        </div>
      )}

      {/* Create Token */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("nodes.createToken")}</h2>
        <form onSubmit={handleCreateToken} className="flex items-end gap-3 max-w-lg">
          <div className="flex-1">
            <FormInput
              label={t("nodes.tokenLabel")}
              placeholder={t("nodes.tokenLabelPlaceholder")}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <FormButton type="submit" disabled={creating} className="shrink-0">
            {creating ? t("nodes.creating") : t("nodes.create")}
          </FormButton>
        </form>
      </div>

      {/* Token list */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("nodes.tokens")}</h2>
        {tokens.length === 0 ? (
          <p className="text-text-tertiary text-sm">{t("nodes.noTokens")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {tokens.map((tk) => (
              <div key={tk.id} className="flex items-center justify-between gap-4 rounded-[var(--radius-input)] border border-line px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-sm text-text-primary truncate">{tk.label}</span>
                  <Badge>{tk.status}</Badge>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-text-tertiary">{new Date(tk.createdAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => void handleRevoke(tk.id)}
                    disabled={revokingId === tk.id}
                    className="rounded-[var(--radius-btn)] border border-danger/30 text-danger px-3 py-1 text-xs font-medium hover:bg-danger/10 cursor-pointer bg-transparent transition-colors disabled:opacity-50"
                  >
                    {revokingId === tk.id ? "..." : t("nodes.revoke")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connected Nodes */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold tracking-tight">{t("nodes.connectedNodes")}</h2>
          <span className="text-xs text-text-tertiary">
            {onlineNodes.length} {t("nodes.online")} / {nodes.length} {t("nodes.total")}
          </span>
        </div>
        {nodes.length === 0 ? (
          <p className="text-text-tertiary text-sm">{t("nodes.noNodes")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {nodes.map((node) => (
              <div key={node.id} className={`flex items-center justify-between gap-4 rounded-[var(--radius-input)] border px-4 py-3 ${
                node.status === "online" ? "border-accent/20" : "border-line opacity-70"
              }`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {node.status === "online" && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
                    )}
                    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${node.status === "online" ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
                  </span>
                  <span className="font-mono text-sm text-text-primary truncate">{node.id.slice(0, 12)}</span>
                </div>
                <div className="flex items-center gap-5 text-xs text-text-secondary shrink-0">
                  <span>{node.ip}</span>
                  <span>{node.modelsCount} {t("nodes.models")}</span>
                  <span className="text-text-tertiary">{formatTimeAgo(node.lastHeartbeat)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Install Guide */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("nodes.installGuide")}</h2>
        <p className="text-text-secondary text-sm mb-4">{t("nodes.installDesc")}</p>
        <div className="relative">
          <pre className="rounded-[var(--radius-input)] bg-bg-0/50 border border-line px-4 py-3 text-sm font-mono text-text-primary overflow-x-auto">
{`# Install xllmapi-node
npm install -g xllmapi-node

# Run with your token
xllmapi-node --token YOUR_TOKEN --api https://api.xllmapi.com`}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton
              text={`npm install -g xllmapi-node\nxllmapi-node --token YOUR_TOKEN --api https://api.xllmapi.com`}
            />
          </div>
        </div>
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
