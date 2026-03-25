import { useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormButton } from "@/components/ui/FormButton";
import { FormInput } from "@/components/ui/FormInput";

export function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await apiJson("/v1/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setMessage(t("auth.passwordResetRequested"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-4 tracking-tight">{t("auth.forgotPasswordTitle")}</h1>
        <p className="text-sm text-text-secondary text-center mb-6">{t("auth.forgotPasswordDesc")}</p>

        {error && <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">{error}</div>}
        {message && <div className="mb-4 rounded-[var(--radius-input)] bg-success/10 border border-success/30 px-4 py-2.5 text-sm text-success">{message}</div>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormInput
            type="email"
            placeholder={t("auth.email.placeholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <FormButton type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("auth.requestPasswordReset")}
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
