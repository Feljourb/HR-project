"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard, FormErrors, PasswordInput, SubmitButton, labelClass, linkClass } from "@/components/auth-card";
import { apiFetch, type Me } from "@/lib/api";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Forcé (mot de passe temporaire) ou volontaire (depuis le menu du compte) ?
  // Par défaut : forcé, le cas le plus strict (pas de bouton "Annuler").
  const [forced, setForced] = useState(true);

  useEffect(() => {
    apiFetch("/api/auth/me/")
      .then((response) => (response.ok ? response.json() : null))
      .then((user: Me | null) => {
        if (user) setForced(user.must_change_password);
      })
      .catch(() => {});
  }, []);

  // Next.js keeps this page alive (hidden): never leave passwords in it.
  // The cleanup runs once it is hidden, so the form stays as is while the next page loads.
  useEffect(() => () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrors([]);
    setLoading(false);
    setForced(true);
  }, []);

  function leave(path: string) {
    router.replace(path);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrors(["The two new passwords do not match."]);
      return;
    }
    setErrors([]);
    setLoading(true);

    try {
      const response = await apiFetch("/api/auth/change-password/", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });

      if (response.ok || response.status === 401) {
        leave(response.ok ? "/" : "/login");
        return;
      }
      // Django sends {"field": ["message", ...]} -> show every message.
      const data = await response.json();
      setErrors(Object.values(data).flat() as string[]);
    } catch {
      setErrors(["Cannot reach the server. Please try again later."]);
    }
    setLoading(false);
  }

  async function signOut() {
    await apiFetch("/api/auth/logout/", { method: "POST" });
    leave("/login");
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle={forced ? "For your security, replace your temporary password before continuing." : "Your other sessions will be signed out."}
    >
      <form onSubmit={handleSubmit}>
        <label htmlFor="current" className={labelClass}>Current password</label>
        <PasswordInput id="current" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} />

        <label htmlFor="new" className={labelClass}>New password</label>
        <PasswordInput id="new" autoComplete="new-password" value={newPassword} onChange={setNewPassword} />
        <p className="mt-1.5 text-[11px] text-slate-500">At least 8 characters, not only numbers, not a common password.</p>

        <label htmlFor="confirm" className={labelClass}>Confirm new password</label>
        <PasswordInput id="confirm" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} />

        <FormErrors messages={errors} />
        <SubmitButton loading={loading} label="Save new password" loadingLabel="Saving..." />
      </form>

      {/* Forcé : on ne peut que sortir. Volontaire : on peut revenir sans rien changer. */}
      {forced ? (
        <button type="button" onClick={signOut} className={linkClass}>
          Sign out
        </button>
      ) : (
        <Link href="/" className={linkClass}>
          Cancel
        </Link>
      )}
    </AuthCard>
  );
}
