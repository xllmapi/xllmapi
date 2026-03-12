import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

export function Header() {
  const { user, isLoggedIn, isAdmin, logout } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

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
          <Link to="/docs" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
            {t("nav.docs")}
          </Link>
          {isLoggedIn && (
            <>
              <Link to="/chat" className="text-text-secondary hover:text-text-primary no-underline transition-colors">
                {t("nav.chat")}
              </Link>
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
            {locale === "zh" ? "EN" : "中"}
          </button>

          {isLoggedIn ? (
            <div className="flex items-center gap-3 ml-1">
              <div className="w-7 h-7 rounded-[var(--radius-avatar)] bg-accent/15 flex items-center justify-center text-accent text-xs font-semibold">
                {(user?.displayName ?? user?.email ?? "U").charAt(0).toUpperCase()}
              </div>
              <button
                onClick={handleLogout}
                className="text-text-tertiary hover:text-danger text-xs cursor-pointer bg-transparent border-none transition-colors"
              >
                {t("nav.logout")}
              </button>
            </div>
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
