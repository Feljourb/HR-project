"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { RequestHistory } from "@/components/requests/request-history";
import { SignedIn } from "@/lib/current-user";

// /requests/12 : l'historique de la demande n°12 (pour tous ceux qu'elle concerne ; sinon Django répond 404).
export default function RequestHistoryPage() {
  return (
    <SignedIn>
      {() => (
        // Suspense : obligatoire autour de useParams (lecture du numéro dans l'adresse).
        <Suspense fallback={<p className="py-12 text-center text-sm text-slate-500">Loading...</p>}>
          <RequestFromAddress />
        </Suspense>
      )}
    </SignedIn>
  );
}

function RequestFromAddress() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  if (!Number.isInteger(requestId)) {
    return <p className="py-12 text-center text-sm text-slate-500">This request does not exist.</p>;
  }
  // key : en passant d'une demande à une autre, tout repart de zéro.
  return <RequestHistory key={requestId} requestId={requestId} />;
}
