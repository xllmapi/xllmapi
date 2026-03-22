import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

interface PendingOffering {
  id: string;
  logicalModel: string;
  realModel: string;
  ownerUserId: string;
  userEmail: string;
  userDisplayName: string;
  providerType: string;
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
  createdAt: string;
}

export function ReviewsPage() {
  const { t } = useLocale();
  const [offerings, setOfferings] = useState<PendingOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await apiJson<{ data: PendingOffering[] }>(
        "/v1/admin/offerings/pending",
      );
      setOfferings(res.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleReview = async (id: string, status: "approved" | "rejected", reason?: string) => {
    setActing(id);
    try {
      await apiJson(`/v1/admin/offerings/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewStatus: status, reason }),
      });
      await loadData();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  };

  const handleReject = (id: string) => {
    const reason = window.prompt(t("admin.reviews.rejectReason"));
    if (reason === null) return;
    void handleReview(id, "rejected", reason);
  };

  if (loading) return <p className="text-text-secondary py-8">{t("common.loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("admin.reviews.title")}</h1>
      {offerings.length === 0 ? (
        <EmptyState message={t("admin.reviews.noRecords")} />
      ) : (
        <div className="space-y-3">
          {offerings.map((o) => (
            <div
              key={o.id}
              className="rounded-[var(--radius-card)] border border-line bg-panel p-5"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="font-mono text-sm">{o.logicalModel}</span>
                    <span className="text-text-tertiary mx-2">&rarr;</span>
                    <span className="font-mono text-sm text-text-secondary">
                      {o.realModel}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-text-tertiary">
                    <span>{o.userDisplayName || o.userEmail || o.ownerUserId}</span>
                    {o.userEmail && o.userDisplayName && (
                      <span className="text-text-tertiary">{o.userEmail}</span>
                    )}
                    <span>&middot;</span>
                    <Badge>{o.providerType || "unknown"}</Badge>
                    <span>&middot;</span>
                    <span>
                      {t("admin.reviews.priceIn")}: {formatTokens(o.fixedPricePer1kInput ?? 0)}/1K
                    </span>
                    <span>
                      {t("admin.reviews.priceOut")}: {formatTokens(o.fixedPricePer1kOutput ?? 0)}/1K
                    </span>
                    <span>&middot;</span>
                    <span>{new Date(o.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2 ml-4 shrink-0">
                  <FormButton
                    variant="ghost"
                    onClick={() => void handleReview(o.id, "approved")}
                    disabled={acting === o.id}
                    className="!text-success !border-success/20 !bg-success/10 hover:!bg-success/20"
                  >
                    {t("admin.reviews.approve")}
                  </FormButton>
                  <FormButton
                    variant="danger"
                    onClick={() => handleReject(o.id)}
                    disabled={acting === o.id}
                  >
                    {t("admin.reviews.reject")}
                  </FormButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
