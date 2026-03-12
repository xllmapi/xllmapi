import { useState } from "react";
import { apiJson } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

export function SecurityPage() {
  const { t } = useLocale();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
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
      setSuccess(t("security.saved"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("security.title")}</h1>

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
        <h2 className="text-base font-semibold mb-4 tracking-tight">{t("security.changePassword")}</h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4 max-w-lg">
          <FormInput
            type="password"
            placeholder={t("security.currentPassword")}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <FormInput
            type="password"
            placeholder={t("security.newPassword")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <FormButton
            type="submit"
            disabled={saving || !currentPassword || !newPassword}
            className="self-start"
          >
            {saving ? t("security.saving") : t("security.save")}
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
