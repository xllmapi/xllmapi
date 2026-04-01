import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { useCachedFetch } from "@/hooks/useCachedFetch";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

type PasswordTab = "current" | "email";

export function SecurityPage() {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSetup = searchParams.get("setup") === "1";
  const { data: sessionData } = useCachedFetch<{ data: { hasPassword?: boolean; email?: string } }>("/v1/auth/session");
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Sync session data
  useEffect(() => {
    if (sessionData) {
      setHasPassword(sessionData.data?.hasPassword ?? true);
      setUserEmail(sessionData.data?.email ?? null);
    }
  }, [sessionData]);

  // Welcome message uses raw fetch (public endpoint, different response format)
  useEffect(() => {
    fetch("/v1/welcome-message")
      .then(r => r.json())
      .then((d: { enabled?: boolean; content?: string }) => {
        if (d.enabled && d.content) setWelcomeMessage(d.content);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Password tab
  const [passwordTab, setPasswordTab] = useState<PasswordTab>("current");
  const [resetSending, setResetSending] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetMaskedEmail, setResetMaskedEmail] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const startCooldown = useCallback((seconds: number) => {
    setResetCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResetCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await apiJson("/v1/me/security/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setHasPassword(true);
      setSearchParams({});
      setSuccess(t("security.saved"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    setError("");
    setSuccess("");
    setResetSending(true);
    try {
      const email = userEmail;
      if (!email) {
        setError(t("security.noEmailFound"));
        return;
      }
      const res = await apiJson<{ maskedEmail?: string; cooldownSeconds?: number }>("/v1/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResetMaskedEmail(res.maskedEmail ?? email.replace(/^(.).+(@.*)$/, "$1***$2"));
      startCooldown(res.cooldownSeconds ?? 60);
      setSuccess(t("security.resetEmailSent"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setResetSending(false);
    }
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setEmailSaving(true);
    try {
      await apiJson("/v1/me/security/email", {
        method: "PATCH",
        body: JSON.stringify({ newEmail, currentPassword: currentPassword || undefined }),
      });
      setNewEmail("");
      setSuccess(t("security.emailChangeRequested"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setEmailSaving(false);
    }
  };

  const showSetup = isSetup || hasPassword === false;
  const passwordTabs: { key: PasswordTab; label: string }[] = [
    { key: "current", label: t("security.tabCurrentPassword") },
    { key: "email", label: t("security.tabEmailReset") },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("security.title")}</h1>

      {showSetup && (
        <div className="mb-6 rounded-[var(--radius-card)] bg-accent/10 border border-accent/30 px-5 py-4">
          <p className="text-sm font-medium text-accent">
            {welcomeMessage || t("security.setupWelcome")}
          </p>
          <p className="text-xs text-text-secondary mt-1">{t("security.setupHint")}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-[var(--radius-input)] bg-success/10 border border-success/30 px-4 py-2.5 text-sm text-success">
          {success}
        </div>
      )}

      {/* Password card */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
        <h2 className="text-base font-semibold mb-4 tracking-tight">
          {showSetup ? t("security.setPassword") : t("security.changePassword")}
        </h2>

        {/* Tab switcher — only show when user already has a password */}
        {!showSetup && (
          <div className="flex gap-1 mb-5 bg-bg-1/50 rounded-lg p-0.5 w-fit">
            {passwordTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setPasswordTab(tab.key); setError(""); setSuccess(""); }}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                  passwordTab === tab.key
                    ? "bg-panel text-text-primary shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab: current password */}
        {(showSetup || passwordTab === "current") && (
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4 max-w-lg">
            {!showSetup && (
              <FormInput
                type="password"
                placeholder={t("security.currentPassword")}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            )}
            <FormInput
              type="password"
              placeholder={showSetup ? t("security.passwordPlaceholder") : t("security.newPassword")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <FormButton
              type="submit"
              disabled={saving || (!showSetup && !currentPassword) || !newPassword}
              className="self-start"
            >
              {saving ? t("security.saving") : (showSetup ? t("security.setPassword") : t("security.save"))}
            </FormButton>
            {isSetup && hasPassword === false && (
              <button
                type="button"
                onClick={() => { setSearchParams({}); }}
                className="text-text-tertiary text-sm hover:text-text-secondary cursor-pointer bg-transparent border-none transition-colors self-start"
              >
                {t("security.skipSetup")}
              </button>
            )}
          </form>
        )}

        {/* Tab: email reset */}
        {!showSetup && passwordTab === "email" && (
          <div className="flex flex-col gap-4 max-w-lg">
            <p className="text-sm text-text-secondary">{t("security.emailResetDesc")}</p>

            {resetMaskedEmail && resetCooldown > 0 ? (
              <div className="rounded-[var(--radius-input)] bg-accent/5 border border-accent/20 px-4 py-3">
                <p className="text-sm text-text-primary">
                  {t("security.resetSentTo").replace("{{email}}", resetMaskedEmail)}
                </p>
                <p className="text-xs text-text-tertiary mt-1">
                  {t("security.resetCooldown").replace("{{seconds}}", String(resetCooldown))}
                </p>
              </div>
            ) : null}

            <FormButton
              onClick={() => void handleRequestPasswordReset()}
              disabled={resetSending || resetCooldown > 0}
              className="self-start"
            >
              {resetSending
                ? t("security.sending")
                : resetCooldown > 0
                  ? `${t("security.resetSentBtn")} (${resetCooldown}s)`
                  : t("security.sendResetEmail")}
            </FormButton>
          </div>
        )}
      </div>

      {/* Email change card */}
      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6 mt-6">
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("security.changeEmail")}</h2>
        <p className="text-sm text-text-secondary mb-4">{t("security.changeEmailDesc")}</p>
        <form onSubmit={handleChangeEmail} className="flex flex-col gap-4 max-w-lg">
          <FormInput
            type="email"
            placeholder={t("security.newEmail")}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
          <FormButton
            type="submit"
            disabled={emailSaving || !newEmail}
            className="self-start"
          >
            {emailSaving ? t("security.saving") : t("security.requestEmailChange")}
          </FormButton>
        </form>
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
