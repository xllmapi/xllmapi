import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

type Mode = "code" | "password";
type Step = "email" | "verify";

export function AuthPage() {
  const { login, isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const { t } = useLocale();

  const [mode, setMode] = useState<Mode>("code");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState("");

  if (isLoggedIn) {
    navigate("/app", { replace: true });
    return null;
  }

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await apiJson<{ devCode?: string }>(
        "/v1/auth/request-code",
        { method: "POST", body: JSON.stringify({ email }) },
      );
      if (result.devCode) setDevCode(result.devCode);
      setStep("verify");
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await apiJson<{
        token: string;
        initialApiKey?: string;
        redirectTo?: string;
      }>("/v1/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      await login({ apiKey: result.initialApiKey ?? null });
      navigate(result.redirectTo ?? "/app", { replace: true });
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await apiJson<{ token: string; redirectTo?: string }>(
        "/v1/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      await login();
      navigate(result.redirectTo ?? "/app", { replace: true });
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-8 tracking-tight">{t("auth.title")}</h1>

        {/* Mode tabs */}
        <div className="flex mb-6 rounded-[var(--radius-input)] border border-line overflow-hidden">
          <button
            onClick={() => { setMode("code"); setStep("email"); setError(""); }}
            className={`flex-1 py-2.5 text-sm cursor-pointer transition-colors ${mode === "code" ? "bg-accent text-[#081018] font-medium" : "bg-transparent text-text-secondary hover:text-text-primary"}`}
          >
            {t("auth.tab.code")}
          </button>
          <button
            onClick={() => { setMode("password"); setError(""); }}
            className={`flex-1 py-2.5 text-sm cursor-pointer transition-colors ${mode === "password" ? "bg-accent text-[#081018] font-medium" : "bg-transparent text-text-secondary hover:text-text-primary"}`}
          >
            {t("auth.tab.password")}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        {mode === "code" && step === "email" && (
          <form onSubmit={handleRequestCode} className="flex flex-col gap-4">
            <FormInput
              type="email"
              placeholder={t("auth.email.placeholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <FormButton type="submit" disabled={loading}>
              {loading ? t("auth.sending") : t("auth.sendCode")}
            </FormButton>
          </form>
        )}

        {mode === "code" && step === "verify" && (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
            <p className="text-text-secondary text-sm">
              {t("auth.codeSent")} <span className="text-text-primary">{email}</span>
            </p>
            {devCode && (
              <p className="text-accent text-sm font-mono">{t("auth.devCode")} {devCode}</p>
            )}
            <FormInput
              type="text"
              placeholder={t("auth.code.placeholder")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <FormButton type="submit" disabled={loading}>
              {loading ? t("auth.verifying") : t("auth.verify")}
            </FormButton>
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setDevCode(""); }}
              className="text-text-secondary text-sm hover:text-text-primary cursor-pointer bg-transparent border-none transition-colors"
            >
              {t("auth.back")}
            </button>
          </form>
        )}

        {mode === "password" && (
          <form onSubmit={handlePasswordLogin} className="flex flex-col gap-4">
            <FormInput
              type="email"
              placeholder={t("auth.email.placeholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <FormInput
              type="password"
              placeholder={t("auth.password.placeholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <FormButton type="submit" disabled={loading}>
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </FormButton>
          </form>
        )}

        <p className="text-text-tertiary text-xs text-center mt-8">
          {t("auth.inviteOnly")}
        </p>
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
