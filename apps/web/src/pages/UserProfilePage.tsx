import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { Badge } from "@/components/ui/Badge";
import { Footer } from "@/components/layout/Footer";

interface UserProfile {
  handle: string;
  displayName: string;
  avatarUrl?: string;
  joinedAt: string;
  offeringCount: number;
  totalServed: number;
}

interface UserOffering {
  id: string;
  logicalModel: string;
  status: string;
  online: boolean;
  votes: number;
}

export function UserProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { t } = useLocale();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [offerings, setOfferings] = useState<UserOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    Promise.all([
      apiJson<{ data: UserProfile }>(`/v1/users/${encodeURIComponent(handle)}/profile`),
      apiJson<{ data: UserOffering[] }>(`/v1/users/${encodeURIComponent(handle)}/offerings`).catch(() => ({ data: [] })),
    ])
      .then(([profileRes, offeringsRes]) => {
        setProfile(profileRes.data ?? null);
        setOfferings(offeringsRes.data ?? []);
      })
      .catch(() => setError(t("common.error")))
      .finally(() => setLoading(false));
  }, [handle, t]);

  if (loading) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center">
        <p className="text-text-secondary">{t("common.loading")}</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center">
        <p className="text-danger">{error || t("common.error")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pt-14">
      <div className="mx-auto max-w-[var(--spacing-content)] px-6 pt-8 pb-16 w-full flex-1">
        {/* Profile header */}
        <div className="flex items-center gap-5 mb-8">
          <div className="w-16 h-16 rounded-full bg-accent/15 flex items-center justify-center text-accent text-2xl font-bold shrink-0">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.displayName} className="w-16 h-16 rounded-full object-cover" />
            ) : (
              profile.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{profile.displayName}</h1>
            <p className="text-text-secondary text-sm">@{profile.handle}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8 max-w-md">
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-lg font-bold text-accent">{profile.offeringCount}</div>
            <div className="text-xs text-text-tertiary mt-1">{t("userProfile.offerings")}</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-lg font-bold text-accent">{profile.totalServed}</div>
            <div className="text-xs text-text-tertiary mt-1">{t("userProfile.totalServed")}</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-center">
            <div className="text-lg font-bold text-text-primary">{new Date(profile.joinedAt).toLocaleDateString()}</div>
            <div className="text-xs text-text-tertiary mt-1">{t("userProfile.joined")}</div>
          </div>
        </div>

        {/* Published offerings */}
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("userProfile.publishedOfferings")}</h2>
        {offerings.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-panel p-8 text-center text-text-tertiary text-sm">
            {t("userProfile.noOfferings")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {offerings.map((o) => (
              <Link
                key={o.id}
                to={`/market/${encodeURIComponent(o.id)}`}
                className="rounded-[var(--radius-card)] border border-line bg-panel p-4 no-underline transition-colors hover:border-accent/25 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {o.online && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 animate-ping" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${o.online ? "bg-emerald-400" : "bg-text-tertiary/40"}`} />
                  </span>
                  <span className="font-mono text-sm font-medium text-text-primary truncate">{o.logicalModel}</span>
                  <Badge>{o.status}</Badge>
                </div>
                <span className="text-xs text-text-tertiary shrink-0">{o.votes} {t("market.votes")}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
