"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ClaimDetail } from "@/components/expenses/claim-detail";
import { SignedIn } from "@/lib/current-user";

// /expenses/12 : la note de frais de la demande n°12 (pour tous ceux qu'elle concerne ; sinon Django répond 404).
export default function ClaimRoute() {
  return (
    <SignedIn>
      {() => (
        // Suspense : obligatoire autour de useParams (lecture du numéro dans l'adresse).
        <Suspense fallback={<p className="py-12 text-center text-sm text-slate-500">Loading...</p>}>
          <ClaimFromAddress />
        </Suspense>
      )}
    </SignedIn>
  );
}

function ClaimFromAddress() {
  const { id } = useParams<{ id: string }>();
  // ?from=requests : la page d'où l'on vient (pour le lien "retour" : "← My requests"...).
  const from = useSearchParams().get("from");
  const requestId = Number(id);
  if (!Number.isInteger(requestId)) {
    return <p className="py-12 text-center text-sm text-slate-500">This expense claim does not exist.</p>;
  }
  return <ClaimDetail key={requestId} requestId={requestId} from={from} />;
}
