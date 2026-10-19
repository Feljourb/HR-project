"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const labelClass = "mt-5 block text-xs font-semibold text-slate-700";
const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#23355d] focus:bg-white focus:ring-3 focus:ring-[#23355d]/15";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await apiFetch("/api/auth/login/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        setError(
          response.status === 401
            ? "Incorrect username or password."
            : "Something went wrong. Please try again.",
        );
        setLoading(false);
        return;
      }

      const user = await response.json();
      router.replace(user.must_change_password ? "/change-password" : "/");
    } catch {
      setError("Cannot reach the server. Please try again later.");
      setLoading(false);
    }
  }

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

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <h1 className="text-xl font-semibold tracking-tight text-[#192646]">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Employee Self-Service Portal</p>

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

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 h-10 w-full rounded-lg bg-[#23355d] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#192646] disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-slate-400">© 2026 Silent Believers Distribution</p>
      </div>
    </main>
  );
}
