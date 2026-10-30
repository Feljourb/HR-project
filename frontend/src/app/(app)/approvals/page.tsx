"use client";

import { TeamApprovals } from "@/components/requests/team-approvals";
import { SignedIn } from "@/lib/current-user";

// /approvals : les demandes qui attendent ma réponse (Django ne renvoie que celles-là).
export default function ApprovalsPage() {
  return <SignedIn>{() => <TeamApprovals />}</SignedIn>;
}
