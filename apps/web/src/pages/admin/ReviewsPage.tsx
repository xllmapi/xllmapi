import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";
import { EmptyState } from "@/components/ui/EmptyState";

interface PendingOffering {
  id: string;
  logicalModel: string;
  realModel: string;
  userId: string;
  userEmail?: string;
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

  const handleReview = async (id: string, status: "approved" | "rejected") => {
    setActing(id);
    try {
      await apiJson(`/v1/admin/offerings/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ reviewStatus: status }),
      });
      await loadData();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
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
              className="rounded-[var(--radius-card)] border border-line bg-panel p-5 flex items-center justify-between"
            >
              <div>
                <p className="font-medium">
                  <span className="font-mono text-sm">{o.logicalModel}</span>
                  <span className="text-text-tertiary mx-2">&rarr;</span>
                  <span className="font-mono text-sm text-text-secondary">
                    {o.realModel}
                  </span>
                </p>
                <p className="text-text-tertiary text-xs mt-1">
                  {o.userEmail || o.userId} &middot;{" "}
                  {new Date(o.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
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
                  onClick={() => void handleReview(o.id, "rejected")}
                  disabled={acting === o.id}
                >
                  {t("admin.reviews.reject")}
                </FormButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
