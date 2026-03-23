import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { formatTokens } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";
import { EmptyState } from "@/components/ui/EmptyState";
// Badge removed — using inline spans for colored type badges

interface PendingOffering {
  id: string;
  logicalModel: string;
  realModel: string;
  ownerUserId: string;
  userEmail: string;
  userDisplayName: string;
  providerType?: string;
  executionMode?: string;
  nodeId?: string;
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
  createdAt?: string;
}

export function ReviewsPage() {
  const { t } = useLocale();
  const [offerings, setOfferings] = useState<PendingOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [autoApproveLoading, setAutoApproveLoading] = useState(false);

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

  const loadAutoApprove = useCallback(async () => {
    try {
      const res = await apiJson<{ data: { key: string; value: string }[] }>("/v1/admin/config");
      const item = (res.data ?? []).find((c) => c.key === "offering_auto_approve");
      setAutoApprove(item?.value === "true");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadData();
    void loadAutoApprove();
  }, [loadData, loadAutoApprove]);

  const toggleAutoApprove = async () => {
    setAutoApproveLoading(true);
    try {
      const newValue = !autoApprove;
      await apiJson("/v1/admin/config", {
        method: "PUT",
        body: JSON.stringify({ key: "offering_auto_approve", value: String(newValue) }),
      });
      setAutoApprove(newValue);
    } catch {
      // ignore
    } finally {
      setAutoApproveLoading(false);
    }
  };

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

      {/* Auto-approve toggle */}
      <div className="flex items-center gap-3 mb-6 rounded-[var(--radius-card)] border border-line bg-panel p-4">
        <span className="text-sm font-medium text-text-secondary">{t("admin.autoApprove")}</span>
        <button
          onClick={() => void toggleAutoApprove()}
          disabled={autoApproveLoading}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer border-none ${
            autoApprove ? "bg-emerald-500" : "bg-text-tertiary/30"
          } ${autoApproveLoading ? "opacity-50" : ""}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              autoApprove ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className={`text-xs font-medium ${autoApprove ? "text-emerald-400" : "text-text-tertiary"}`}>
          {autoApprove ? t("admin.autoApproveOn") : t("admin.autoApproveOff")}
        </span>
      </div>

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
                    {o.executionMode === "node" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-500/10 text-purple-400">🖥️ 分布式</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-500/10 text-blue-400">☁️ {o.providerType || "平台托管"}</span>
                    )}
                    <span>&middot;</span>
                    <span>
                      in {formatTokens(o.fixedPricePer1kInput ?? 0)} / out {formatTokens(o.fixedPricePer1kOutput ?? 0)}
                    </span>
                    {o.createdAt && (
                      <>
                        <span>&middot;</span>
                        <span>{new Date(o.createdAt).toLocaleDateString()}</span>
                      </>
                    )}
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
