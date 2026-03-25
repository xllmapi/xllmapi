import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";

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
          "block rounded-[var(--radius-input)] px-3 py-2 text-sm no-underline transition-colors whitespace-nowrap",
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

  return (
    <div className="mx-auto max-w-[var(--spacing-content)] px-6 pt-[72px] pb-12 min-h-screen">
      {/* Mobile tab bar */}
      <nav className="md:hidden flex gap-1 overflow-x-auto pb-4 -mx-2 px-2">
        <SidebarLink to="/admin" label={t("admin.sidebar.overview")} end />
        <SidebarLink to="/admin/users" label={t("admin.sidebar.users")} />
        <SidebarLink to="/admin/invitations" label={t("admin.sidebar.invitations")} />
        <SidebarLink to="/admin/reviews" label={t("admin.sidebar.reviews")} />
        <SidebarLink to="/admin/usage" label={t("admin.sidebar.usage")} />
        <SidebarLink to="/admin/requests" label={t("admin.sidebar.requests")} />
        <SidebarLink to="/admin/settlements" label={t("admin.sidebar.settlements")} />
        <SidebarLink to="/admin/providers" label={t("admin.sidebar.providers")} />
        <SidebarLink to="/admin/settings" label={t("admin.sidebar.settings")} />
        <SidebarLink to="/admin/notifications" label={t("admin.sidebar.notifications")} />
        <SidebarLink to="/admin/audit" label={t("admin.sidebar.audit")} />
      </nav>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-[180px] shrink-0">
          <nav className="sticky top-[72px] flex flex-col gap-0.5">
            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2">
              {t("admin.sidebar.management")}
            </p>
            <SidebarLink to="/admin" label={t("admin.sidebar.overview")} end />
            <SidebarLink to="/admin/users" label={t("admin.sidebar.users")} />
            <SidebarLink to="/admin/invitations" label={t("admin.sidebar.invitations")} />
            <SidebarLink to="/admin/reviews" label={t("admin.sidebar.reviews")} />
            <SidebarLink to="/admin/usage" label={t("admin.sidebar.usage")} />
            <SidebarLink to="/admin/requests" label={t("admin.sidebar.requests")} />
            <SidebarLink to="/admin/settlements" label={t("admin.sidebar.settlements")} />

            <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2 mt-4">
              {t("admin.sidebar.system")}
            </p>
            <SidebarLink to="/admin/providers" label={t("admin.sidebar.providers")} />
            <SidebarLink to="/admin/settings" label={t("admin.sidebar.settings")} />
            <SidebarLink to="/admin/notifications" label={t("admin.sidebar.notifications")} />
            <SidebarLink to="/admin/audit" label={t("admin.sidebar.audit")} />
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
