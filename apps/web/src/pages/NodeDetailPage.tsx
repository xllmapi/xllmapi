import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { formatTokens, getContextLimit, formatContextLength } from "@/lib/utils";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";
import { invalidateUserModels } from "@/hooks/useUserModels";

interface NodeDetail {
  id: string;
  publicNodeId: string;
  logicalModel: string;
  realModel?: string;
  ownerDisplayName?: string;
  ownerHandle?: string;
  ownerUserId?: string;
  executionMode?: string;
  enabled?: boolean;
  reviewStatus?: string;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  dailyTokenLimit?: number;
  maxConcurrency?: number;
  nodeConnectedAt?: string;
  totalRequests?: number;
  totalSuccess?: number;
  totalTokens?: number;
  upvotes?: number;
  downvotes?: number;
  nodeId?: string;
  offeringId?: string;
}

function formatUptime(connectedAt?: string): string {
  if (!connectedAt) return "--";
  const diffMs = Date.now() - new Date(connectedAt).getTime();
  if (diffMs < 0) return "--";
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function NodeDetailPage() {
  const { publicNodeId } = useParams<{ publicNodeId: string }>();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinChecking, setJoinChecking] = useState(true);

  useEffect(() => {
    if (!publicNodeId) return;
    setLoading(true);
    apiJson<{ data: NodeDetail }>(`/v1/network/node/${encodeURIComponent(publicNodeId)}`)
      .then((res) => {
        setNode(res.data ?? null);
      })
      .catch(() => {
        setNode(null);
      })
      .finally(() => setLoading(false));
  }, [publicNodeId]);

  // Check if user has joined (favorited) this offering
  useEffect(() => {
    if (!node?.offeringId && !node?.id) return;
    const offeringId = node.offeringId || node.id;
    setJoinChecking(true);
    apiJson<{ data: { inPool: boolean } }>(`/v1/me/connection-pool/${encodeURIComponent(offeringId)}`)
      .then((res) => {
        setJoined(res.data?.inPool ?? false);
      })
      .catch(() => {
        setJoined(false);
      })
      .finally(() => setJoinChecking(false));
  }, [node]);

  const handleJoinLeave = useCallback(async () => {
    if (!node || joinLoading) return;
    const offeringId = node.offeringId || node.id;
    setJoinLoading(true);
    try {
      if (joined) {
        await apiJson(`/v1/me/connection-pool/${encodeURIComponent(offeringId)}`, { method: "DELETE" });
        setJoined(false);
      } else {
        await apiJson(`/v1/me/connection-pool/${encodeURIComponent(offeringId)}`, { method: "POST" });
        setJoined(true);
      }
      invalidateUserModels();
    } catch {
      // ignore
    } finally {
      setJoinLoading(false);
    }
  }, [node, joined, joinLoading]);

  if (loading) {
    return (
      <div className="min-h-screen pt-14">
        <div className="mx-auto max-w-2xl px-6 pt-16">
          <div className="animate-pulse">
            <div className="h-6 bg-line rounded w-1/3 mb-4" />
            <div className="h-4 bg-line rounded w-1/2 mb-8" />
            <div className="h-24 bg-line rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary mb-4">Node not found: {publicNodeId}</p>
          <button onClick={() => navigate("/mnetwork")} className="text-accent hover:underline cursor-pointer">
            {t("models.back")}
          </button>
        </div>
      </div>
    );
  }

  const isOnline = node.enabled !== false && node.reviewStatus === "approved";
  const successRate =
    node.totalRequests && node.totalRequests > 0
      ? Math.round(((node.totalSuccess ?? node.totalRequests) / node.totalRequests) * 100)
      : null;

  return (
    <div className="min-h-screen flex flex-col pt-14">
      <div className="mx-auto max-w-2xl px-6 pt-8 pb-24 flex-1 w-full">
        {/* Back button */}
        <div className="mb-6">
          <button
            onClick={() => navigate("/mnetwork")}
            className="text-xs text-text-tertiary hover:text-accent transition-colors cursor-pointer bg-transparent border-none p-0"
          >
            {t("models.back")}
          </button>
        </div>

        {/* Header card */}
        <div className="mb-8 rounded-[var(--radius-card)] p-5 border border-purple-500/20 bg-purple-500/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold font-mono tracking-tight">{node.logicalModel}</h1>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    isOnline
                      ? "border-emerald-400/30 text-emerald-400"
                      : "border-text-tertiary/30 text-text-tertiary"
                  }`}
                >
                  {isOnline ? "\uD83D\uDFE2 \u8FD0\u884C\u4E2D" : "\u26AA \u79BB\u7EBF"}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-500/10 text-purple-400">
                  {"\uD83D\uDDA5\uFE0F"} {t("modelsMgmt.distributed")}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-xs text-text-secondary">
                <span>
                  {t("modelsMgmt.supplier")}: {node.ownerDisplayName || "--"}{" "}
                  {node.ownerHandle && (
                    <span className="text-text-tertiary">(@{node.ownerHandle})</span>
                  )}
                </span>
                <span className="font-mono text-text-tertiary">
                  {t("nodeDetail.title")}: {node.publicNodeId || publicNodeId}
                </span>
              </div>
            </div>

            {!joinChecking && (
              <button
                onClick={() => void handleJoinLeave()}
                disabled={joinLoading}
                className={`rounded-[var(--radius-btn)] px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer border shrink-0 ${
                  joined
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-accent/30 text-accent hover:bg-accent/10 bg-transparent"
                } ${joinLoading ? "opacity-50" : ""}`}
              >
                {joinLoading ? "..." : joined ? `${t("modelDetail.joined")} \u2713` : t("modelDetail.joinList")}
              </button>
            )}
          </div>
        </div>

        {/* Running Stats */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("modelsMgmt.status.running")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <div className="text-lg font-bold text-accent">{formatUptime(node.nodeConnectedAt)}</div>
              <div className="text-[11px] text-text-tertiary mt-1">{t("nodeDetail.uptime")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-text-primary">--ms</div>
              <div className="text-[11px] text-text-tertiary mt-1">{t("nodeDetail.avgLatency")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-text-primary">
                {successRate != null ? `${successRate}%` : "--"}
              </div>
              <div className="text-[11px] text-text-tertiary mt-1">{t("nodeDetail.successRate")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-text-primary">{node.totalRequests ?? 0}</div>
              <div className="text-[11px] text-text-tertiary mt-1">{t("nodeDetail.totalRequests")}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-text-primary">{formatContextLength(getContextLimit(node.logicalModel))}</div>
              <div className="text-[11px] text-text-tertiary mt-1">{t("common.context")}</div>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-6">
          <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("nodeDetail.price")}</h3>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-tertiary text-xs">in</span>
            <span className="font-mono text-accent font-medium">
              {formatTokens(node.fixedPricePer1kInput ?? 0)}
            </span>
            <span className="text-text-tertiary/40">/</span>
            <span className="text-text-tertiary text-xs">out</span>
            <span className="font-mono text-accent font-medium">
              {formatTokens(node.fixedPricePer1kOutput ?? 0)}
            </span>
            <span className="text-text-tertiary text-[10px]">xtokens per 1K tokens</span>
          </div>
        </div>

        {/* Configuration */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
          <h3 className="text-xs font-semibold text-text-secondary mb-4">{t("nodeDetail.config")}</h3>
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-tertiary text-xs">{t("modelsMgmt.dailyLimit")}</span>
              <span className="font-mono text-text-primary">
                {node.dailyTokenLimit ? formatTokens(node.dailyTokenLimit) : "--"} tokens
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-tertiary text-xs">{t("modelsMgmt.maxConc")}</span>
              <span className="font-mono text-text-primary">{node.maxConcurrency ?? "--"}</span>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
