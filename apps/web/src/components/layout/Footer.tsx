import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="border-t border-line py-8 text-center text-sm text-text-tertiary">
      <div className="mx-auto max-w-[var(--spacing-content)] px-6 flex flex-col items-center gap-3">
        <nav className="flex gap-6">
          <Link to="/" className="text-text-tertiary hover:text-text-secondary no-underline transition-colors">
            Home
          </Link>
          <Link to="/docs" className="text-text-tertiary hover:text-text-secondary no-underline transition-colors">
            Docs
          </Link>
        </nav>
        <p className="text-text-tertiary/60 text-xs">&copy; {new Date().getFullYear()} xllmapi</p>
      </div>
    </footer>
  );
}
