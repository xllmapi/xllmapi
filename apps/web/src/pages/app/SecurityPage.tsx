import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

export function SecurityPage() {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSetup = searchParams.get("setup") === "1";
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    apiJson<{ data: { hasPassword?: boolean } }>("/v1/auth/session")
      .then((res) => setHasPassword(res.data?.hasPassword ?? true))
      .catch(() => setHasPassword(true));

    // Fetch admin-configured welcome message for new users
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("security.title")}</h1>

      {(isSetup || hasPassword === false) && (
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

      <div className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
        <h2 className="text-base font-semibold mb-4 tracking-tight">
          {(isSetup || hasPassword === false) ? t("security.setPassword") : t("security.changePassword")}
        </h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4 max-w-lg">
          {hasPassword !== false && !isSetup && (
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
            placeholder={(isSetup || hasPassword === false) ? t("security.passwordPlaceholder") : t("security.newPassword")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <FormButton
            type="submit"
            disabled={saving || (hasPassword !== false && !isSetup && !currentPassword) || !newPassword}
            className="self-start"
          >
            {saving ? t("security.saving") : ((isSetup || hasPassword === false) ? t("security.setPassword") : t("security.save"))}
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
      </div>

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
