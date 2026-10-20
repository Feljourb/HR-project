import Image from "next/image";
import type { ReactNode } from "react";

// Shared by the login and change-password pages.
export const labelClass = "mt-5 block text-xs font-semibold text-slate-700";
export const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#23355d] focus:bg-white focus:ring-3 focus:ring-[#23355d]/15";
export const buttonClass =
  "mt-6 h-10 w-full rounded-lg bg-[#23355d] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#192646] disabled:opacity-60";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            <Image src="/logo.png" alt="Silent Believers Distribution" width={56} height={49} className="size-full object-contain" />
          </div>
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-[#192646]">SILENT BELIEVERS</p>
            <p className="text-[10px] tracking-[0.2em] text-[#8C6D52]">DISTRIBUTION</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h1 className="text-xl font-semibold tracking-tight text-[#192646]">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">© 2026 Silent Believers Distribution</p>
      </div>
    </main>
  );
}

export function FormErrors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
