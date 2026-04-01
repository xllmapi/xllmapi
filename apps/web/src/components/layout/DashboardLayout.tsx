import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { apiJson } from "@/lib/api";
import { ScrollableTabBar } from "./ScrollableTabBar";

function SidebarLink({
  to,
  label,
  end,
  highlight,
}: {
  to: string;
  label: string;
  end?: boolean;
  highlight?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "block whitespace-nowrap shrink-0 rounded-[var(--radius-input)] px-3 py-2 text-sm no-underline transition-colors",
          isActive
            ? "bg-accent/10 text-accent font-medium"
            : highlight
              ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
              : "text-text-secondary hover:text-text-primary hover:bg-accent-bg",
        )
      }
    >
      <span className="flex items-center gap-1.5">
        {label}
        {highlight && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      </span>
    </NavLink>
  );
}

export function DashboardLayout() {
  const { t } = useLocale();
  const [invitationsEnabled, setInvitationsEnabled] = useState<boolean | null>(null);
  const [referralReward, setReferralReward] = useState(0);

  useEffect(() => {
    apiJson<{ data: { enabled: boolean; unlimited: boolean; referralReward?: number } }>("/v1/me/invitation-stats")
      .then((res) => {
        setInvitationsEnabled(res.data.unlimited ? true : res.data.enabled);
        setReferralReward(Number(res.data.referralReward ?? 0));
      })
      .catch(() => setInvitationsEnabled(true));
  }, []);

  return (
    <div className="mx-auto max-w-[var(--spacing-content)] px-4 md:px-6 pt-[72px] pb-12 min-h-screen">
      {/* Mobile tab bar */}
      <ScrollableTabBar>
        <SidebarLink to="/app" label={t("sidebar.overview")} end />
        <SidebarLink to="/app/models/connected" label={t("sidebar.connected")} />
        <SidebarLink to="/app/models/provided" label={t("sidebar.provided")} />
        {invitationsEnabled && <SidebarLink to="/app/invitations" label={t("sidebar.invitations")} highlight={referralReward > 0} />}
        <SidebarLink to="/app/profile" label={t("sidebar.profile")} />
        <SidebarLink to="/app/security" label={t("sidebar.security")} />
        <SidebarLink to="/app/api-keys" label={t("sidebar.apiKeys")} />
      </ScrollableTabBar>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-[180px] shrink-0">
          <nav className="sticky top-[72px] flex flex-col gap-0.5">
            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2">
              {t("sidebar.platform")}
            </p>
            <SidebarLink to="/app" label={t("sidebar.overview")} end />

            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 mt-3">
              {t("sidebar.models")}
            </p>
            <SidebarLink to="/app/models/connected" label={t("sidebar.connected")} />
            <SidebarLink to="/app/models/provided" label={t("sidebar.provided")} />

            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2 mt-4">
              {t("sidebar.account")}
            </p>
            <SidebarLink to="/app/profile" label={t("sidebar.profile")} />
            <SidebarLink to="/app/security" label={t("sidebar.security")} />
            <SidebarLink to="/app/api-keys" label={t("sidebar.apiKeys")} />
            {invitationsEnabled && <SidebarLink to="/app/invitations" label={t("sidebar.invitations")} highlight={referralReward > 0} />}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
