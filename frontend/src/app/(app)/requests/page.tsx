"use client";

import { Suspense } from "react";
import { MyRequests } from "@/components/requests/my-requests";
import { SignedIn } from "@/lib/current-user";

// /requests : mes demandes (tous les rôles ; Django ne renvoie que les miennes).
// <Suspense> : la page lit l'adresse (?tab=received), Next.js l'exige.
export default function RequestsPage() {
  return <Suspense fallback={null}><SignedIn>{(me) => <MyRequests me={me} />}</SignedIn></Suspense>;
}
