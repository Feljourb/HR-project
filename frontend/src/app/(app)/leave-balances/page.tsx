"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LeaveBalances } from "@/components/leaves/leave-balances";
import { SignedIn } from "@/lib/current-user";

// /leave-balances : le solde de congés de chaque collaborateur (RH : son pôle ; Admin RH et IT : les deux).
// /leave-balances?employee=12 : la page s'ouvre avec le panneau de ce collaborateur (lien depuis sa fiche).
export default function LeaveBalancesPage() {
  return (
    // Suspense : obligatoire autour de useSearchParams (lecture de ?employee= dans l'adresse).
    <Suspense fallback={<p className="py-12 text-center text-sm text-slate-500">Loading...</p>}>
      <SignedIn>{() => <BalancesFromAddress />}</SignedIn>
    </Suspense>
  );
}

function BalancesFromAddress() {
  const employee = Number(useSearchParams().get("employee")) || null;
  return <LeaveBalances key={employee ?? "all"} initialEmployee={employee} />;
}
