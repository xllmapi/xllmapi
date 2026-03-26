import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";
import { FormInput } from "@/components/ui/FormInput";

export function ResetPasswordPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await apiJson("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword })
      });
      setMessage(t("auth.passwordResetDone"));
      window.setTimeout(() => navigate("/auth", { replace: true }), 900);
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-4 tracking-tight">{t("auth.resetPasswordTitle")}</h1>
        <p className="text-sm text-text-secondary text-center mb-6">{t("auth.resetPasswordDesc")}</p>

        {!token && <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">{t("auth.resetPasswordMissingToken")}</div>}
        {error && <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">{error}</div>}
        {message && <div className="mb-4 rounded-[var(--radius-input)] bg-success/10 border border-success/30 px-4 py-2.5 text-sm text-success">{message}</div>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormInput
            type="password"
            placeholder={t("security.newPassword")}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <FormButton type="submit" disabled={loading || !token || newPassword.length < 8}>
            {loading ? t("common.loading") : t("auth.resetPasswordSubmit")}
          </FormButton>
        </form>

        <div className="mt-6 text-center">
          <Link to="/auth" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
            {t("auth.backToSignIn")}
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
