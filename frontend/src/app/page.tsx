"use client";

import { SbdDashboard } from "@/components/sbd-dashboard";
import { useMe } from "@/lib/use-me";

// Page d'accueil : le tableau de bord. useMe s'occupe de la connexion et des redirections.
export default function HomePage() {
  const { me, logout } = useMe();

  if (me === null) {
    return <p className="m-auto text-sm text-slate-500">Loading...</p>;
  }
  return <SbdDashboard me={me} onLogout={logout} />;
}
