import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/Badge";
import { Footer } from "@/components/layout/Footer";

interface OfferingDetail {
  id: string;
  logicalModel: string;
  realModel?: string;
  ownerDisplayName?: string;
  ownerHandle?: string;
  executionMode?: string;
  enabled?: boolean;
  reviewStatus?: string;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  upvotes?: number;
  downvotes?: number;
  favoriteCount?: number;
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
              <Badge>{detail.enabled !== false && detail.reviewStatus === "approved" ? "available" : "offline"}</Badge>
              {(detail.executionMode === "platform" || !detail.executionMode) ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-500/10 text-blue-400">☁️ 平台节点</span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-500/10 text-purple-400">🖥️ 分布式</span>
              )}
              <span className="relative flex h-2.5 w-2.5">
                {detail.enabled !== false && detail.reviewStatus === "approved" && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${detail.enabled !== false && detail.reviewStatus === "approved" ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
              </span>
            </div>
            {detail.ownerHandle ? (
              <Link to={`/u/${detail.ownerHandle}`} className="text-sm text-text-secondary hover:text-accent no-underline transition-colors">
                {detail.ownerDisplayName || detail.ownerHandle}
              </Link>
            ) : (
              <span className="text-sm text-text-secondary">{detail.ownerDisplayName || "—"}</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 text-xs text-text-tertiary">
            <span>👍 {detail.upvotes ?? 0} / 👎 {detail.downvotes ?? 0}</span>
            <span>❤️ {detail.favoriteCount ?? 0}</span>
          </div>
        </div>

        {/* Price info */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-lg font-bold text-accent">{formatTokens(detail.fixedPricePer1kInput ?? 0)}</div>
            <div className="text-xs text-text-tertiary mt-1">Input / 1K tokens</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-lg font-bold text-accent">{formatTokens(detail.fixedPricePer1kOutput ?? 0)}</div>
            <div className="text-xs text-text-tertiary mt-1">Output / 1K tokens</div>
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
