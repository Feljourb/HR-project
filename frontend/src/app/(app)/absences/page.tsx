"use client";

import { Absences } from "@/components/leaves/absences";
import { SignedIn } from "@/lib/current-user";

// /absences : qui est en congé, mois par mois (RH : son pôle ; Admin RH et IT : les deux).
export default function AbsencesPage() {
  return <SignedIn>{() => <Absences />}</SignedIn>;
}
