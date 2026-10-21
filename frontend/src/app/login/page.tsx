"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthCard, FormErrors, buttonClass, inputClass, labelClass } from "@/components/auth-card";
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
          setLoading(false);
          return;
        }
        router.replace(nextPage(data as Me));
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
        router.replace(nextPage(await response.json()));
        return;
      }
      if (response.status === 401) {
        // The 5 minutes after the password are over: start again.
        setStep("password");
        setCode("");
        setErrors(["Session expired, please sign in again."]);
      } else {
        setErrors([response.status === 429 ? TOO_MANY : "Invalid code."]);
      }
    } catch {
      setErrors(["Cannot reach the server. Please try again later."]);
    }
    setLoading(false);
  }

  if (step === "code") {
    return (
      <AuthCard title="Two-factor authentication" subtitle="Enter the 6-digit code shown in your authenticator app.">
        <form onSubmit={handleCode}>
          <label htmlFor="code" className={labelClass}>Code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputClass} text-center font-mono text-lg tracking-[0.3em]`}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">Lost your phone? Enter one of your recovery codes instead.</p>

          <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[#23355d]" />
            Trust this device for 30 days
          </label>

          <FormErrors messages={errors} />

          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => { setStep("password"); setCode(""); setErrors([]); }}
          className="mt-4 w-full text-center text-xs font-medium text-slate-500 hover:text-[#23355d]"
        >
          Back
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" subtitle="Employee Self-Service Portal">
      <form onSubmit={handlePassword}>
        <label htmlFor="username" className={labelClass}>Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          placeholder="firstname.lastname"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />

        <label htmlFor="password" className={labelClass}>Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

        <FormErrors messages={errors} />

        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}
