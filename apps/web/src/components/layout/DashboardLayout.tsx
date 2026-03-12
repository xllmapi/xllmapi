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
          "block rounded-[var(--radius-input)] px-3 py-2 text-sm no-underline transition-colors",
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

  return (
    <div className="mx-auto flex max-w-[var(--spacing-content)] gap-6 px-6 pt-[72px] pb-12 min-h-screen">
      <aside className="w-[180px] shrink-0">
        <nav className="sticky top-[72px] flex flex-col gap-0.5">
          <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2">
            {t("sidebar.platform")}
          </p>
          <SidebarLink to="/app" label={t("sidebar.overview")} end />
          <SidebarLink to="/app/network" label={t("sidebar.network")} />
          <SidebarLink to="/app/invitations" label={t("sidebar.invitations")} />

          <p className="text-text-tertiary text-[10px] font-semibold uppercase tracking-wider px-3 py-2 mt-4">
            {t("sidebar.account")}
          </p>
          <SidebarLink to="/app/profile" label={t("sidebar.profile")} />
          <SidebarLink to="/app/security" label={t("sidebar.security")} />
        </nav>
      </aside>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
