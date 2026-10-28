"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DirectoryList } from "@/components/directory/directory-list";
import { SignedIn } from "@/lib/current-user";

// /directory : l'annuaire, pour tous les rôles.
export default function DirectoryPage() {
  return (
    // Suspense : obligatoire autour de useSearchParams (lecture de ?search= dans l'adresse).
    <Suspense fallback={<p className="py-12 text-center text-sm text-slate-500">Loading...</p>}>
      <SignedIn>{() => <DirectoryFromAddress />}</SignedIn>
    </Suspense>
  );
}

// Lit ?search=... (envoyé par la barre de recherche du haut).
// key : une nouvelle recherche depuis la barre du haut repart d'un annuaire neuf.
function DirectoryFromAddress() {
  const search = useSearchParams().get("search") ?? "";
  return <DirectoryList key={search} initialSearch={search} />;
}
