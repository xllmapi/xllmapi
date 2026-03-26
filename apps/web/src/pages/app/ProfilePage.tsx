import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";
import { FormInput } from "@/components/ui/FormInput";
import { FormButton } from "@/components/ui/FormButton";

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const { t } = useLocale();

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (user?.displayName) setDisplayName(user.displayName);
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await apiJson("/v1/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      await refresh();
      setSuccess(t("profile.saved"));
    } catch (err: unknown) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 tracking-tight">{t("profile.title")}</h1>

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
        {/* Avatar */}
        <div className="mb-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-[var(--radius-avatar)] bg-accent/15 flex items-center justify-center text-accent text-2xl font-bold">
            {(user?.displayName ?? user?.email ?? "U").charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium">{user?.displayName || "—"}</p>
            <p className="text-text-secondary text-xs">{user?.email}</p>
            {user?.handle && <p className="text-text-tertiary text-xs font-mono mt-0.5">{user.handle}</p>}
          </div>
        </div>

        <form onSubmit={handleUpdateProfile} className="flex flex-col gap-4 max-w-lg">
          <div>
            <label className="text-text-secondary text-xs block mb-1.5">{t("profile.email")}</label>
            <p className="text-sm text-text-secondary">{user?.email}</p>
          </div>
          <FormInput
            label={t("profile.nickname")}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <FormButton type="submit" disabled={saving} className="self-start">
            {saving ? t("profile.saving") : t("profile.save")}
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
