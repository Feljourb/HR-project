"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthCard, FormErrors, buttonClass, inputClass, labelClass } from "@/components/auth-card";
import { apiFetch } from "@/lib/api";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

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

      if (response.ok) {
        router.replace("/");
        return;
      }
      if (response.status === 401) {
        router.replace("/login");
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
    router.replace("/login");
  }

  return (
    <AuthCard title="Choose a new password" subtitle="For your security, replace your temporary password before continuing.">
      <form onSubmit={handleSubmit}>
        <label htmlFor="current" className={labelClass}>Current password</label>
        <input
          id="current"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />

        <label htmlFor="new" className={labelClass}>New password</label>
        <input
          id="new"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1.5 text-[11px] text-slate-500">At least 8 characters, not only numbers, not a common password.</p>

        <label htmlFor="confirm" className={labelClass}>Confirm new password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />

        <FormErrors messages={errors} />

        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Saving..." : "Save new password"}
        </button>
      </form>

      <button type="button" onClick={signOut} className="mt-4 w-full text-center text-xs font-medium text-slate-500 hover:text-[#23355d]">
        Sign out
      </button>
    </AuthCard>
  );
}
