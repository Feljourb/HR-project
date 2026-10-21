"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { AlertCircle, CalendarDays, Eye, EyeOff, LoaderCircle, ReceiptText, ShieldCheck } from "lucide-react";
import { NetworkCanvas } from "@/components/dashboard/network-canvas";

// Shared by the login, change-password and MFA pages.
export const labelClass = "mt-5 block text-xs font-semibold text-slate-700";
const fieldClass =
  "h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#23355d] focus:bg-white focus:ring-3 focus:ring-[#23355d]/15";
export const inputClass = `mt-1.5 ${fieldClass}`;
export const buttonClass =
  "mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#23355d] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#192646] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#23355d]/30 disabled:cursor-not-allowed disabled:opacity-60";
export const linkClass = "mt-4 w-full text-center text-xs font-medium text-slate-500 transition-colors hover:text-[#23355d]";

const HIGHLIGHTS = [
  { icon: CalendarDays, text: "Request leave and follow its approval" },
  { icon: ReceiptText, text: "Submit and track your expense claims" },
  { icon: ShieldCheck, text: "Secure sign-in with two-factor authentication" },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        <Image src="/logo.png" alt="Silent Believers Distribution" width={56} height={49} className="size-full object-contain" />
      </div>
      <div>
        <p className={`text-[11px] font-bold tracking-[0.12em] ${light ? "text-white" : "text-[#192646]"}`}>SILENT BELIEVERS</p>
        <p className={`text-[10px] tracking-[0.2em] ${light ? "text-blue-200" : "text-[#8C6D52]"}`}>DISTRIBUTION</p>
      </div>
    </div>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
      {/* Brand side, from the dashboard design (hidden on small screens). */}
      {/* Same background and map as the leadership video ("This video isn't available"). */}
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#192646_0%,#101B35_70%)] p-10 text-[#F7F1EC] lg:flex lg:flex-col lg:justify-between">
        <NetworkCanvas className="absolute inset-0 size-full opacity-70" />

        <div className="relative"><Logo light /></div>

        <div className="relative max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#F2C98F]">Employee Self-Service Portal</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-white">Your HR space,<br />in one place.</h2>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-[#D5DBE8]">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10">
                  <Icon className="size-4 text-[#E9D5C0]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-[#A9B4CC]">© 2026 Silent Believers Distribution</p>
      </aside>

      {/* Form side. */}
      <section className="flex items-center justify-center bg-white px-4 py-10 sm:px-10">
        <div className="sbd-rise w-full max-w-sm">
          <div className="mb-10 lg:hidden"><Logo /></div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#192646]">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
          {children}
          <p className="mt-10 text-center text-[11px] text-slate-400 lg:hidden">© 2026 Silent Believers Distribution</p>
        </div>
      </section>
    </main>
  );
}

// Password field with "show / hide" and a Caps Lock warning.
export function PasswordInput({ id, value, onChange, autoComplete }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  return (
    <>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
          className={`${fieldClass} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {capsLock && <p className="mt-1.5 text-[11px] font-medium text-amber-700">Caps Lock is on.</p>}
    </>
  );
}

export function SubmitButton({ loading, label, loadingLabel, disabled = false }: {
  loading: boolean;
  label: string;
  loadingLabel: string;
  disabled?: boolean;
}) {
  return (
    <button type="submit" disabled={loading || disabled} className={buttonClass}>
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {loading ? loadingLabel : label}
    </button>
  );
}

export function FormErrors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="mt-4 flex gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div>
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
}
