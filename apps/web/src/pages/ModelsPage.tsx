import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { Footer } from "@/components/layout/Footer";
import { useLocale } from "@/hooks/useLocale";
import { Cpu, Users } from "lucide-react";

interface NetworkModel {
  logicalModel: string;
  providerCount?: number;
  enabledOfferingCount?: number;
  ownerCount?: number;
  status?: string;
  providers?: string[];
  minInputPrice?: number | null;
  minOutputPrice?: number | null;
}

function StatusDot({ status }: { status: string }) {
  const color = status === "available" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <span className="relative flex h-2 w-2">
      <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-40 animate-ping`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export function ModelsPage() {
  const [models, setModels] = useState<NetworkModel[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLocale();

  useEffect(() => {
    apiJson<{ data: NetworkModel[] }>("/v1/network/models")
      .then((r) => setModels(
        (r.data ?? []).filter((m) => !m.logicalModel.startsWith("community-") && !m.logicalModel.startsWith("e2e-"))
      ))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalNodes = models.reduce((sum, m) => sum + (m.enabledOfferingCount ?? 0), 0);
  const totalProviders = new Set(models.flatMap((m) => m.providers ?? [])).size;

  return (
    <div className="min-h-screen flex flex-col pt-14">
      {/* Header */}
      <section className="pt-16 pb-10 px-6 text-center">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
          {t("models.title")}
        </h1>
        <p className="text-text-secondary text-base max-w-xl mx-auto">
          {t("models.subtitle")}
        </p>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-8">
        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
          <div className="text-center">
            <div className="text-2xl font-bold text-accent">{models.length}</div>
            <div className="text-xs text-text-tertiary mt-1">{t("models.stat.models")}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-accent">{totalNodes}</div>
            <div className="text-xs text-text-tertiary mt-1">{t("models.stat.nodes")}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-accent">{totalProviders}</div>
            <div className="text-xs text-text-tertiary mt-1">{t("models.stat.providers")}</div>
          </div>
        </div>
      </section>

      {/* Model grid */}
      <section className="mx-auto max-w-[var(--spacing-content)] px-6 pb-24 flex-1">
        {loading ? (
          <div className="text-center text-text-tertiary py-20">{t("common.loading")}</div>
        ) : models.length === 0 ? (
          <div className="text-center text-text-tertiary py-20">{t("models.empty")}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {models.map((m) => (
              <div
                key={m.logicalModel}
                className="rounded-[var(--radius-card)] border border-line bg-panel p-5 transition-colors hover:border-accent/25"
              >
                {/* Top row: name + status */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-mono font-medium text-text-primary truncate mr-2">
                    {m.logicalModel}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <StatusDot status={m.status ?? "available"} />
                    <span className="text-[10px] text-text-tertiary capitalize">{m.status ?? "available"}</span>
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-text-tertiary" />
                    {m.enabledOfferingCount ?? 0} {t("models.nodes")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3 text-text-tertiary" />
                    {m.ownerCount ?? 0} {t("models.suppliers")}
                  </span>
                </div>

                {/* Providers */}
                {m.providers && m.providers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {m.providers.map((p) => (
                      <span
                        key={p}
                        className="text-[10px] text-text-tertiary bg-accent/6 border border-accent/10 rounded-full px-2 py-0.5"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
