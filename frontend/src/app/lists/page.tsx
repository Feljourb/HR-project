"use client";

import { AppShell } from "@/components/app-shell";
import { ListsManager } from "@/components/lists/lists-manager";
import { seesBothPoles } from "@/lib/api";
import { useMe } from "@/lib/use-me";

// /lists : la gestion des listes de référence, pour l'Admin RH et l'IT.
export default function ListsPage() {
  const { me, logout } = useMe();

  if (me === null) {
    return <p className="m-auto text-sm text-slate-500">Loading...</p>;
  }

  return (
    <AppShell me={me} onLogout={logout} active="Reference lists" breadcrumb={["Management & HR", "Reference lists"]}>
      {/* Les autres rôles : un message (et Django refuse de toute façon leurs modifications). */}
      {seesBothPoles(me) ? (
        <ListsManager />
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-600">
          Only Admin RH can manage the reference lists.
        </p>
      )}
    </AppShell>
  );
}
