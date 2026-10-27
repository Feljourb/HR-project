"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DirectoryList } from "@/components/directory/directory-list";
import { useMe } from "@/lib/use-me";

// /directory : l'annuaire, pour tous les rôles.
export default function DirectoryPage() {
  const { me, logout } = useMe();

  if (me === null) {
    return <p className="m-auto text-sm text-slate-500">Loading...</p>;
  }

  return (
    <AppShell me={me} onLogout={logout} active="Employee Directory" breadcrumb={["Company Services", "Employee Directory"]}>
      {/* Suspense : obligatoire autour de useSearchParams (lecture de ?search= dans l'adresse). */}
      <Suspense fallback={<p className="py-12 text-center text-sm text-slate-500">Loading...</p>}>
        <DirectoryFromAddress />
      </Suspense>
    </AppShell>
  );
}

// Lit ?search=... (envoyé par la barre de recherche du haut).
// key : une nouvelle recherche depuis la barre du haut repart d'un annuaire neuf.
function DirectoryFromAddress() {
  const search = useSearchParams().get("search") ?? "";
  return <DirectoryList key={search} initialSearch={search} />;
}
