"use client";

import { ListsManager } from "@/components/lists/lists-manager";
import { seesBothPoles } from "@/lib/api";
import { SignedIn } from "@/lib/current-user";

// /lists : la gestion des listes de référence, pour l'Admin RH et l'IT.
export default function ListsPage() {
  return (
    <SignedIn>
      {(me) => seesBothPoles(me) ? (
        <ListsManager />
      ) : (
        // Les autres rôles : un message (et Django refuse de toute façon leurs modifications).
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-600">
          Only Admin RH can manage the reference lists.
        </p>
      )}
    </SignedIn>
  );
}
