"use client";

import { AppShell } from "@/components/app-shell";
import { MyProfile } from "@/components/profile/my-profile";
import { useMe } from "@/lib/use-me";

// /profile : "Mon profil", pour tous les rôles (chacun voit seulement SON dossier).
export default function ProfilePage() {
  const { me, logout } = useMe();

  if (me === null) {
    return <p className="m-auto text-sm text-slate-500">Loading...</p>;
  }

  return (
    <AppShell me={me} onLogout={logout} active="My Profile" breadcrumb={["Personal Space", "My Profile"]}>
      <MyProfile />
    </AppShell>
  );
}
