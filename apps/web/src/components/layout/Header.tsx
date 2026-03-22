import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";
import { apiJson } from "@/lib/api";
import { LogOut, LayoutDashboard, Bell } from "lucide-react";

export function Header() {
  const { user, isLoggedIn, isAdmin, logout } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate("/");
  };

  // Fetch unread notification count + listen for updates
  const refreshUnread = useCallback(() => {
    if (!isLoggedIn) return;
    apiJson<{ data: { count: number } }>("/v1/notifications/unread-count")
      .then((r) => setUnreadCount(r.data?.count ?? 0))
      .catch(() => {});
  }, [isLoggedIn]);

  useEffect(() => {
    refreshUnread();
    const handler = () => refreshUnread();
    window.addEventListener("notifications-changed", handler);
    return () => window.removeEventListener("notifications-changed", handler);
  }, [refreshUnread]);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-line bg-panel-strong">
      <div className="mx-auto flex h-full max-w-[var(--spacing-content)] items-center justify-between px-6">
        <Link
          to="/"
          className="font-heading text-lg font-bold text-accent no-underline hover:no-underline tracking-tight"
        >
          xllmapi
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link to="/mnetwork" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
            {t("nav.models")}
          </Link>
          <Link to="/market" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
            {t("nav.market")}
          </Link>
          <Link to="/docs" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
            {t("nav.docs")}
          </Link>
          <Link to="/chat" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
            {t("nav.chat")}
          </Link>
          {isLoggedIn && (
            <>
              <Link to="/app" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
                {t("nav.dashboard")}
              </Link>
              {isAdmin && (
                <Link to="/admin" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
                  {t("nav.admin")}
                </Link>
              )}
            </>
          )}

          {/* Locale toggle */}
          <button
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="text-text-tertiary hover:text-text-primary text-xs font-medium cursor-pointer bg-transparent border border-line rounded-[var(--radius-input)] px-2 py-1 transition-colors"
          >
            {locale === "zh" ? "EN" : "\u4e2d"}
          </button>

          {isLoggedIn ? (
            <>
              {/* Notification bell */}
              <button
                onClick={() => navigate("/app/notifications")}
                className="relative text-text-secondary hover:text-text-primary cursor-pointer bg-transparent border-none transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-danger text-[10px] font-bold text-white flex items-center justify-center px-1">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              <div ref={menuRef} className="relative ml-1">
                {/* Avatar button */}
                <button
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="w-7 h-7 rounded-[var(--radius-avatar)] bg-accent/15 flex items-center justify-center text-accent text-xs font-semibold cursor-pointer border-none transition-colors hover:bg-accent/25"
                >
                  {(user?.displayName ?? user?.email ?? "U").charAt(0).toUpperCase()}
                </button>

                {/* Dropdown menu */}
                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 w-40 rounded-[var(--radius-card)] border border-line/80 bg-bg-1/95 shadow-[var(--shadow-card)] overflow-hidden z-50"
                    style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
                  >
                    <div className="py-1">
                      <button
                        onClick={() => { setMenuOpen(false); navigate("/app"); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-text-primary hover:bg-accent-bg cursor-pointer border-none bg-transparent transition-colors"
                      >
                        <LayoutDashboard className="w-3.5 h-3.5 text-text-tertiary" />
                        {t("nav.dashboard")}
                      </button>
                      <div className="my-1 border-t border-line/60" />
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-danger/80 hover:bg-danger/10 cursor-pointer border-none bg-transparent transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        {t("nav.logout")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link
              to="/auth"
              className="rounded-[var(--radius-btn)] bg-accent px-4 py-1.5 text-sm font-semibold text-[#081018] no-underline hover:no-underline hover:opacity-90 shadow-[var(--shadow-cta)] transition-opacity"
            >
              {t("nav.signIn")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
