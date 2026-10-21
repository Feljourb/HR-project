"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AuthCard, FormErrors, PasswordInput, SubmitButton, inputClass, labelClass, linkClass,
} from "@/components/auth-card";
import { apiFetch, nextPage, type Me } from "@/lib/api";

const TOO_MANY = "Too many attempts. Please wait one minute.";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "code">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Next.js keeps this page alive (hidden) after we leave it.
  // Empty the form before leaving, so it is clean after a logout.
  function leave(user: Me) {
    setStep("password");
    setUsername("");
    setPassword("");
    setCode("");
    setErrors([]);
    setLoading(false);
    router.replace(nextPage(user));
  }

  // Step 1: username + password.
  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setLoading(true);

    try {
      const response = await apiFetch("/api/auth/login/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.mfa_required) {
          setStep("code"); // password OK, now the 6-digit code
          setPassword("");
          setLoading(false);
          return;
        }
        leave(data as Me);
        return;
      }
      setErrors([
        response.status === 401 ? "Incorrect username or password."
          : response.status === 429 ? TOO_MANY
          : "Something went wrong. Please try again.",
      ]);
    } catch {
      setErrors(["Cannot reach the server. Please try again later."]);
    }
    setLoading(false);
  }

  // Step 2 (only when MFA is on for this user): the code of the authenticator app.
  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setLoading(true);

    try {
      const response = await apiFetch("/api/auth/login/mfa/", {
        method: "POST",
        body: JSON.stringify({ code, remember }),
      });

      if (response.ok) {
        leave(await response.json());
        return;
      }
      if (response.status === 401) {
        // The 5 minutes after the password are over: start again.
        setStep("password");
        setCode("");
        setErrors(["Session expired, please sign in again."]);
      } else {
        setErrors([response.status === 429 ? TOO_MANY : "Invalid code. Try the new code shown in the app."]);
      }
    } catch {
      setErrors(["Cannot reach the server. Please try again later."]);
    }
    setLoading(false);
  }

  function backToPassword() {
    setStep("password");
    setCode("");
    setErrors([]);
  }

  if (step === "code") {
    return (
      <AuthCard title="Two-factor authentication" subtitle="Open your authenticator app and enter the 6-digit code.">
        <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
          Signed in as <span className="font-semibold text-[#192646]">{username}</span>
        </p>
        <form onSubmit={handleCode}>
          <label htmlFor="code" className={labelClass}>Verification code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputClass} text-center font-mono text-lg tracking-[0.35em]`}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">Lost your phone? Enter one of your recovery codes instead.</p>

          <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-xs text-slate-600">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[#23355d]" />
            Trust this device for 30 days
          </label>

          <FormErrors messages={errors} />
          <SubmitButton loading={loading} label="Verify" loadingLabel="Verifying..." />
        </form>
        <button type="button" onClick={backToPassword} className={linkClass}>
          Not you? Use another account
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your employee space.">
      <form onSubmit={handlePassword}>
        <label htmlFor="username" className={labelClass}>Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="firstname.lastname"
          required
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />

        <label htmlFor="password" className={labelClass}>Password</label>
        <PasswordInput id="password" autoComplete="current-password" value={password} onChange={setPassword} />

        <FormErrors messages={errors} />
        <SubmitButton loading={loading} label="Sign in" loadingLabel="Signing in..." />
      </form>
      <p className="mt-5 text-center text-xs text-slate-500">
        Forgot your password? Contact your HR team.
      </p>
    </AuthCard>
  );
}
