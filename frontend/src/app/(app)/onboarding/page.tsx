"use client";

import { JourneysPage } from "@/components/journeys/journeys-page";
import { SignedIn } from "@/lib/current-user";

// /onboarding : les arrivées et départs du pôle, avec leur checklist (RH ; Admin RH et IT : les deux pôles).
export default function OnboardingRoute() {
  return <SignedIn>{() => <JourneysPage />}</SignedIn>;
}
