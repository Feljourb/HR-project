"use client";

import { SbdDashboard } from "@/components/sbd-dashboard";
import { SignedIn } from "@/lib/current-user";

// Page d'accueil : le tableau de bord. La connexion et le cadre sont gérés par app/(app)/layout.tsx.
export default function HomePage() {
  return <SignedIn>{(me) => <SbdDashboard me={me} />}</SignedIn>;
}
