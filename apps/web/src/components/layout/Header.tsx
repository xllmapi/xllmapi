import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";
import { apiJson } from "@/lib/api";
import { LogOut, LayoutDashboard, Bell } from "lucide-react";

declare const __XLLMAPI_DOCS_URL__: string;

export function Header() {
  const { user, isLoggedIn, isAdmin, logout } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
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
          <a href={__XLLMAPI_DOCS_URL__} className="text-text-secondary hover:text-text-primary no-underline transition-colors">
            {t("nav.docs")}
          </a>
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

          {/* GitHub */}
          <a
            href="https://github.com/xllmapi/xllmapi"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-tertiary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-5 h-5" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>

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
