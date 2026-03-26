import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

export function ConfirmEmailChangePage() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? t("common.loading") : t("security.emailChangeMissingToken"));

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await apiJson("/v1/auth/confirm-email-change", {
          method: "POST",
          body: JSON.stringify({ token })
        });
        if (!cancelled) {
          setStatus("success");
          setMessage(t("security.emailChangeConfirmed"));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setStatus("error");
          setMessage(extractError(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, t]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-panel p-6">
        <h1 className="text-2xl font-bold mb-4 tracking-tight">{t("security.confirmEmailTitle")}</h1>
        <div className={`rounded-[var(--radius-input)] border px-4 py-3 text-sm ${
          status === "success"
            ? "bg-success/10 border-success/30 text-success"
            : status === "error"
              ? "bg-danger/10 border-danger/30 text-danger"
              : "bg-accent-bg border-line text-text-secondary"
        }`}>
          {message}
        </div>
        <div className="mt-6 text-center">
          <Link to="/app/security" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
            {t("security.backToSecurity")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    return (err as { error: { message: string } }).error.message;
  }
  return "Something went wrong";
}
