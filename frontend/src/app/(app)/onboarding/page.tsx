"use client";

import { Suspense } from "react";
import { JourneysPage } from "@/components/journeys/journeys-page";
import { SignedIn } from "@/lib/current-user";

// /onboarding : les arrivées et départs du pôle, avec leur checklist (RH ; Admin RH et IT : les deux pôles).
// <Suspense> : la page lit ?request= (useSearchParams), Next.js l'exige.
export default function OnboardingRoute() {
  return <SignedIn>{() => <Suspense><JourneysPage /></Suspense>}</SignedIn>;
}
