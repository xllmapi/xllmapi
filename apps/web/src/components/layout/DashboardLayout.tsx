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
}: {
  to: string;
  label: string;
  end?: boolean;
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
            : "text-text-secondary hover:text-text-primary hover:bg-accent-bg",
        )
      }
    >
      {label}
    </NavLink>
  );
}

export function DashboardLayout() {
  const { t } = useLocale();
  const [invitationsEnabled, setInvitationsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    apiJson<{ data: { enabled: boolean; unlimited: boolean } }>("/v1/me/invitation-stats")
      .then((res) => {
        setInvitationsEnabled(res.data.unlimited ? true : res.data.enabled);
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
        {invitationsEnabled && <SidebarLink to="/app/invitations" label={t("sidebar.invitations")} />}
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
            {invitationsEnabled && <SidebarLink to="/app/invitations" label={t("sidebar.invitations")} />}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
