import { Link } from "react-router-dom";

declare const __XLLMAPI_DOCS_URL__: string;

export function Footer() {
  return (
    <footer className="border-t border-line py-8 text-center text-sm text-text-tertiary">
      <div className="mx-auto max-w-[var(--spacing-content)] px-6 flex flex-col items-center gap-3">
        <nav className="flex gap-6">
          <Link to="/" className="text-text-tertiary hover:text-text-secondary no-underline transition-colors">
            Home
          </Link>
          <a href={__XLLMAPI_DOCS_URL__} className="text-text-tertiary hover:text-text-secondary no-underline transition-colors">
            Docs
          </a>
        </nav>
        <p className="text-text-tertiary/60 text-xs">&copy; {new Date().getFullYear()} xllmapi</p>
      </div>
    </footer>
  );
}
