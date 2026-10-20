"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SbdDashboard } from "@/components/sbd-dashboard";
import { apiFetch, type Me } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  HR_ADMIN: "Admin RH",
  HR: "RH",
  MANAGER: "Manager",
  COLLABORATOR: "Collaborateur",
};

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  // Ask Django who is logged in, then show the dashboard.
  useEffect(() => {
    apiFetch("/api/auth/me/")
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const user: Me = await response.json();
        if (user.must_change_password) {
          router.replace("/change-password");
          return;
        }
        setMe(user);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await apiFetch("/api/auth/logout/", { method: "POST" });
    router.replace("/login");
  }

  if (me === null) {
    return <p className="m-auto text-sm text-slate-500">Loading...</p>;
  }

  return (
    <SbdDashboard
      username={me.username}
      roleLabel={ROLE_LABELS[me.role] ?? me.role}
      canSeeManagement={me.role !== "COLLABORATOR"}
      onLogout={logout}
    />
  );
}
