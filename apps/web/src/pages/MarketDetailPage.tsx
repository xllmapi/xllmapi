import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/Badge";
import { Footer } from "@/components/layout/Footer";

interface OfferingDetail {
  id: string;
  logicalModel: string;
  supplierName: string;
  supplierHandle: string;
  type: "official" | "distributed";
  online: boolean;
  status: string;
  stability: number;
  avgLatencyMs: number;
  successRate: number;
  totalServed: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
  votes: number;
  favorites: number;
  myVote: number;
  myFavorite: boolean;
}

interface Comment {
  id: string;
  userId: string;
  displayName: string;
  content: string;
  createdAt: string;
}

export function MarketDetailPage() {
  const { offeringId } = useParams<{ offeringId: string }>();
  const { t } = useLocale();
  const { isLoggedIn } = useAuth();
  const [detail, setDetail] = useState<OfferingDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [voting, setVoting] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!offeringId) return;
    try {
      const [detailRes, commentsRes] = await Promise.all([
        apiJson<{ data: OfferingDetail }>(`/v1/market/offerings/${encodeURIComponent(offeringId)}`),
        apiJson<{ data: Comment[] }>(`/v1/market/offerings/${encodeURIComponent(offeringId)}/comments`).catch(() => ({ data: [] })),
      ]);
      setDetail(detailRes.data ?? null);
      setComments(commentsRes.data ?? []);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [offeringId, t]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleVote = async (direction: 1 | -1) => {
    if (!detail || voting) return;
    setVoting(true);
    try {
      await apiJson(`/v1/market/offerings/${encodeURIComponent(detail.id)}/vote`, {
        method: "POST",
        body: JSON.stringify({ direction }),
      });
      await loadDetail();
    } catch {
      // ignore
    } finally {
      setVoting(false);
    }
  };

  const handleFavorite = async () => {
    if (!detail) return;
    try {
      await apiJson(`/v1/market/offerings/${encodeURIComponent(detail.id)}/favorite`, {
        method: "POST",
      });
      await loadDetail();
    } catch {
      // ignore
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !commentText.trim()) return;
    setPosting(true);
    try {
      await apiJson(`/v1/market/offerings/${encodeURIComponent(detail.id)}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setCommentText("");
      await loadDetail();
    } catch {
      // ignore
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center">
        <p className="text-text-secondary">{t("common.loading")}</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center">
        <p className="text-danger">{error || t("common.error")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pt-14">
      <div className="mx-auto max-w-[var(--spacing-content)] px-6 pt-8 pb-16 w-full flex-1">
        {/* Breadcrumb */}
        <Link to="/market" className="text-xs text-accent no-underline hover:underline mb-6 inline-block">
          {t("market.back")}
        </Link>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold tracking-tight">{detail.logicalModel}</h1>
              <Badge>{detail.status}</Badge>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                detail.type === "official" ? "bg-accent/10 text-accent" : "bg-purple-500/10 text-purple-400"
              }`}>
                {detail.type === "official" ? t("market.badge.official") : t("market.badge.distributed")}
              </span>
              <span className="relative flex h-2.5 w-2.5">
                {detail.online && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${detail.online ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
              </span>
            </div>
            <Link to={`/u/${detail.supplierHandle}`} className="text-sm text-text-secondary hover:text-accent no-underline transition-colors">
              {detail.supplierName} (@{detail.supplierHandle})
            </Link>
          </div>

          {/* Action buttons */}
          {isLoggedIn && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleVote(1)}
                disabled={voting}
                className={`rounded-[var(--radius-btn)] border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  detail.myVote === 1 ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-text-secondary hover:border-accent/30"
                } bg-transparent disabled:opacity-50`}
              >
                +{detail.votes}
              </button>
              <button
                onClick={() => void handleVote(-1)}
                disabled={voting}
                className={`rounded-[var(--radius-btn)] border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  detail.myVote === -1 ? "border-danger/40 bg-danger/10 text-danger" : "border-line text-text-secondary hover:border-danger/30"
                } bg-transparent disabled:opacity-50`}
              >
                -
              </button>
              <button
                onClick={() => void handleFavorite()}
                className={`rounded-[var(--radius-btn)] border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  detail.myFavorite ? "border-amber-400/40 bg-amber-400/10 text-amber-400" : "border-line text-text-secondary hover:border-amber-400/30"
                } bg-transparent`}
              >
                {detail.myFavorite ? t("market.favorited") : t("market.favorite")} ({detail.favorites})
              </button>
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: t("market.metric.stability"), value: `${(detail.stability * 100).toFixed(1)}%` },
            { label: t("market.metric.latency"), value: `${detail.avgLatencyMs}ms` },
            { label: t("market.metric.successRate"), value: `${(detail.successRate * 100).toFixed(1)}%` },
            { label: t("market.metric.totalServed"), value: String(detail.totalServed) },
          ].map((m, i) => (
            <div key={i} className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
              <div className="text-lg font-bold text-accent">{m.value}</div>
              <div className="text-xs text-text-tertiary mt-1">{m.label}</div>
            </div>
          ))}
        </div>

        {/* Price info */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-5 mb-8">
          <h2 className="text-base font-semibold mb-3 tracking-tight">{t("market.pricing")}</h2>
          <div className="flex gap-8 text-sm">
            <div>
              <span className="text-text-tertiary">{t("market.inputPrice")}</span>
              <span className="ml-2 font-mono text-text-primary">{detail.inputPricePer1k} xt/1K</span>
            </div>
            <div>
              <span className="text-text-tertiary">{t("market.outputPrice")}</span>
              <span className="ml-2 font-mono text-text-primary">{detail.outputPricePer1k} xt/1K</span>
            </div>
          </div>
        </div>

        {/* Comments */}
        <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
          <h2 className="text-base font-semibold mb-4 tracking-tight">{t("market.comments")} ({comments.length})</h2>

          {isLoggedIn && (
            <form onSubmit={handleComment} className="mb-6">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={t("market.commentPlaceholder")}
                rows={3}
                className="w-full rounded-[var(--radius-input)] border border-line px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
                style={{ backgroundColor: "rgba(16,21,34,0.6)" }}
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={posting || !commentText.trim()}
                  className="rounded-[var(--radius-btn)] bg-accent px-4 py-1.5 text-sm font-semibold text-[#081018] cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {posting ? t("market.posting") : t("market.post")}
                </button>
              </div>
            </form>
          )}

          {comments.length === 0 ? (
            <p className="text-text-tertiary text-sm">{t("market.noComments")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {comments.map((c) => (
                <div key={c.id} className="border-b border-line pb-4 last:border-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-medium text-text-primary">{c.displayName}</span>
                    <span className="text-xs text-text-tertiary">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
