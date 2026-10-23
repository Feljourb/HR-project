"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AuthCard, FormErrors, SubmitButton, buttonClass, inputClass, labelClass, linkClass,
} from "@/components/auth-card";
import { apiFetch } from "@/lib/api";

type Setup = { qr_code: string; secret: string };

export default function MfaSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Ask Django for the QR code (the same one if the page is reloaded).
  useEffect(() => {
    apiFetch("/api/auth/mfa/setup/", { method: "POST" })
      .then(async (response) => {
        if (response.status === 401) router.replace("/login");
        else if (!response.ok) router.replace("/"); // already active
        else setSetup(await response.json());
      })
      .catch(() => setErrors(["Cannot reach the server. Please try again later."]));
  }, [router]);

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setLoading(true);
    try {
      const response = await apiFetch("/api/auth/mfa/confirm/", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (response.ok) setRecoveryCodes(data.recovery_codes);
      else setErrors(response.status === 429 ? ["Too many attempts. Please wait one minute."] : Object.values(data).flat() as string[]);
    } catch {
      setErrors(["Cannot reach the server. Please try again later."]);
    }
    setLoading(false);
  }

  function downloadCodes() {
    const file = new Blob([`SBD HR Portal - recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "sbd-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // Next.js keeps this page alive (hidden): never leave codes in it.
  // The cleanup runs once it is hidden, so the page stays as is while the next one loads.
  useEffect(() => () => {
    setSetup(null);
    setCode("");
    setRecoveryCodes([]);
    setErrors([]);
    setLoading(false);
  }, []);

  function leave(path: string) {
    router.replace(path);
  }

  async function signOut() {
    await apiFetch("/api/auth/logout/", { method: "POST" });
    leave("/login");
  }

  // After activation: show the recovery codes once.
  if (recoveryCodes.length > 0) {
    return (
      <AuthCard title="Save your recovery codes" subtitle="Each code works once if you lose your phone. They will not be shown again.">
        <ul className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm text-[#192646] ring-1 ring-slate-200">
          {recoveryCodes.map((recovery) => <li key={recovery} className="text-center">{recovery}</li>)}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n"))} className="h-9 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:border-[#23355d]/30 hover:text-[#23355d]">
            Copy
          </button>
          <button type="button" onClick={downloadCodes} className="h-9 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:border-[#23355d]/30 hover:text-[#23355d]">
            Download
          </button>
        </div>
        <button type="button" onClick={() => leave("/")} className={buttonClass}>
          I saved my codes, continue
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Activate two-factor authentication" subtitle="Your account requires a code from your phone at sign in.">
      <ol className="mt-5 space-y-1.5 text-xs text-slate-600">
        <li>1. Open <b>Microsoft Authenticator</b> (or Google Authenticator) on your phone.</li>
        <li>2. Tap <b>+</b>, choose <b>Other account</b>, and scan this QR code.</li>
        <li>3. Enter the 6-digit code shown in the app.</li>
      </ol>

      <div className="mt-4 flex justify-center">
        {setup ? (
          // eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimize
          <img src={setup.qr_code} alt="QR code to scan with your authenticator app" className="size-44 rounded-lg bg-white p-2 ring-1 ring-slate-200" />
        ) : (
          <div className="size-44 animate-pulse rounded-lg bg-slate-100" />
        )}
      </div>
      {setup && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Can&apos;t scan? Enter this key: <span className="font-mono text-slate-700">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span>
        </p>
      )}

      <form onSubmit={handleConfirm}>
        <label htmlFor="code" className={labelClass}>Code</label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${inputClass} text-center font-mono text-lg tracking-[0.3em]`}
        />
        <FormErrors messages={errors} />
        <SubmitButton loading={loading} label="Activate" loadingLabel="Activating..." disabled={!setup} />
      </form>

      <button type="button" onClick={signOut} className={linkClass}>
        Sign out
      </button>
    </AuthCard>
  );
}
