"use client";

import { HrClaims } from "@/components/expenses/hr-claims";
import { SignedIn } from "@/lib/current-user";

// /reimbursements : les notes de frais du pôle à rembourser (RH ; Admin RH et IT : les deux pôles).
export default function ReimbursementsRoute() {
  return <SignedIn>{() => <HrClaims />}</SignedIn>;
}
