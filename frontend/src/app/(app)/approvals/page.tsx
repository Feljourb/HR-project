"use client";

import { Suspense } from "react";
import { TeamApprovals } from "@/components/requests/team-approvals";
import { SignedIn } from "@/lib/current-user";

// /approvals : les demandes qui attendent ma réponse (Django ne renvoie que celles-là).
// <Suspense> : la page lit l'adresse (?tab=team, le lien "Requested for my team" de la page Documents).
export default function ApprovalsPage() {
  return <Suspense fallback={null}><SignedIn>{(me) => <TeamApprovals me={me} />}</SignedIn></Suspense>;
}
