"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthCard, FormErrors, buttonClass, inputClass, labelClass } from "@/components/auth-card";
import { apiFetch, type Me } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setLoading(true);

    try {
      const response = await apiFetch("/api/auth/login/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const user: Me = await response.json();
        router.replace(user.must_change_password ? "/change-password" : "/");
        return;
      }
      setErrors([
        response.status === 401
          ? "Incorrect username or password."
          : "Something went wrong. Please try again.",
      ]);
    } catch {
      setErrors(["Cannot reach the server. Please try again later."]);
    }
    setLoading(false);
  }

  return (
    <AuthCard title="Sign in" subtitle="Employee Self-Service Portal">
      <form onSubmit={handleSubmit}>
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
