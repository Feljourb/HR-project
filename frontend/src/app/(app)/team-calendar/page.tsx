"use client";

import { TeamMonth } from "@/components/leaves/team-month";
import { SignedIn } from "@/lib/current-user";

// /team-calendar : mon équipe (les personnes dont je suis le N+1), qui est absent, mois par mois (P2 step 2b).
export default function TeamCalendarPage() {
  return <SignedIn>{() => <TeamMonth />}</SignedIn>;
}
