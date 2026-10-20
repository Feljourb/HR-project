"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { apiFetch, type Me } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  HR_ADMIN: "Admin RH",
  HR: "RH",
  MANAGER: "Manager",
  COLLABORATOR: "Collaborateur",
};

function salutation(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Ask Django who is logged in.
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

  const roleLabel = ROLE_LABELS[me.role] ?? me.role;
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-[#0F172A]">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        username={me.username}
        roleLabel={roleLabel}
        canSeeManagement={me.role !== "COLLABORATOR"}
        onLogout={logout}
      />

      <div className={`transition-[margin] duration-200 ${sidebarOpen ? "lg:ml-[264px]" : "lg:ml-0"}`}>
        <Header username={me.username} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

        <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
          <section>
            <p className="text-xs font-medium text-[#8C6D52]">{today}</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[#192646]">
              {salutation(new Date().getHours())}, {me.username}
            </h1>
            <span className="mt-2 inline-flex rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#23355d] ring-1 ring-slate-200">
              {roleLabel}
            </span>
          </section>

          <section className="rounded-xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            Your leave requests, expense claims and documents will appear here as each module is built.
          </section>

          <footer className="border-t border-slate-200 pt-4 text-[11px] text-slate-400">© 2026 Silent Believers Distribution</footer>
        </main>
      </div>
    </div>
  );
}
