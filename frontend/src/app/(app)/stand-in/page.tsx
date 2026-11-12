"use client";

import { StandIn } from "@/components/requests/stand-in";
import { SignedIn } from "@/lib/current-user";

// /stand-in : les demandes qu'un collaborateur traite à la place d'un valideur absent (délégation).
export default function StandInPage() {
  return <SignedIn>{() => <StandIn />}</SignedIn>;
}
