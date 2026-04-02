import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { adminPageImports } from "@/App";
import { KeepAliveOutlet } from "./KeepAliveOutlet";
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
          "block shrink-0 whitespace-nowrap rounded-[var(--radius-input)] px-3 py-2 text-sm no-underline transition-colors",
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

export function AdminLayout() {
  const { t } = useLocale();

  useEffect(() => {
    const prefetch = () => {
      adminPageImports.forEach((load) => load());
    };
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(prefetch);
      return () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(prefetch, 200);
      return () => clearTimeout(id);
    }
  }, []);

  return (
    <div className="mx-auto max-w-[var(--spacing-content)] px-4 md:px-6 pt-[calc(var(--header-height,56px)+16px)] pb-12 min-h-screen">
      {/* Mobile tab bar */}
      <ScrollableTabBar>
        {/* Management */}
        <SidebarLink to="/admin" label={t("admin.sidebar.overview")} end />
        <SidebarLink to="/admin/users" label={t("admin.sidebar.users")} />
        <SidebarLink to="/admin/invitations" label={t("admin.sidebar.invitations")} />
        <SidebarLink to="/admin/usage" label={t("admin.sidebar.usage")} />
        <SidebarLink to="/admin/requests" label={t("admin.sidebar.requests")} />
        <SidebarLink to="/admin/settlements" label={t("admin.sidebar.settlements")} />
        <SidebarLink to="/admin/settlement-failures" label={t("admin.sidebar.settlementFailures")} />
        <span className="inline-block w-px h-4 bg-line/40 shrink-0 mx-1 self-center" />
        {/* Model Nodes */}
        <SidebarLink to="/admin/reviews" label={t("admin.sidebar.reviews")} />
        <SidebarLink to="/admin/node-health" label={t("admin.sidebar.nodeHealth")} />
        <span className="inline-block w-px h-4 bg-line/40 shrink-0 mx-1 self-center" />
        {/* System */}
        <SidebarLink to="/admin/providers" label={t("admin.sidebar.providers")} />
        <SidebarLink to="/admin/settings" label={t("admin.sidebar.settings")} />
        <SidebarLink to="/admin/releases" label={t("admin.sidebar.releases")} />
        <SidebarLink to="/admin/banner" label={t("admin.sidebar.banner")} />
        <SidebarLink to="/admin/notifications" label={t("admin.sidebar.notifications")} />
        <SidebarLink to="/admin/email-deliveries" label={t("admin.sidebar.emailDeliveries")} />
        <SidebarLink to="/admin/security-events" label={t("admin.sidebar.securityEvents")} />
        <SidebarLink to="/admin/audit" label={t("admin.sidebar.audit")} />
      </ScrollableTabBar>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-[180px] shrink-0">
          <nav className="sticky top-[calc(var(--header-height,56px)+16px)] flex flex-col gap-0.5">
            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2">
              {t("admin.sidebar.management")}
            </p>
            <SidebarLink to="/admin" label={t("admin.sidebar.overview")} end />
            <SidebarLink to="/admin/users" label={t("admin.sidebar.users")} />
            <SidebarLink to="/admin/invitations" label={t("admin.sidebar.invitations")} />
            <SidebarLink to="/admin/usage" label={t("admin.sidebar.usage")} />
            <SidebarLink to="/admin/requests" label={t("admin.sidebar.requests")} />
            <SidebarLink to="/admin/settlements" label={t("admin.sidebar.settlements")} />
            <SidebarLink to="/admin/settlement-failures" label={t("admin.sidebar.settlementFailures")} />

            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2 mt-4">
              {t("admin.sidebar.modelNodes")}
            </p>
            <SidebarLink to="/admin/reviews" label={t("admin.sidebar.reviews")} />
            <SidebarLink to="/admin/node-health" label={t("admin.sidebar.nodeHealth")} />

            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2 mt-4">
              {t("admin.sidebar.system")}
            </p>
            <SidebarLink to="/admin/providers" label={t("admin.sidebar.providers")} />
            <SidebarLink to="/admin/settings" label={t("admin.sidebar.settings")} />
            <SidebarLink to="/admin/logs" label={t("admin.sidebar.logs")} />
            <SidebarLink to="/admin/releases" label={t("admin.sidebar.releases")} />
            <SidebarLink to="/admin/banner" label={t("admin.sidebar.banner")} />
            <SidebarLink to="/admin/notifications" label={t("admin.sidebar.notifications")} />
            <SidebarLink to="/admin/email-deliveries" label={t("admin.sidebar.emailDeliveries")} />
            <SidebarLink to="/admin/security-events" label={t("admin.sidebar.securityEvents")} />
            <SidebarLink to="/admin/audit" label={t("admin.sidebar.audit")} />
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <KeepAliveOutlet />
        </main>
      </div>
    </div>
  );
}
