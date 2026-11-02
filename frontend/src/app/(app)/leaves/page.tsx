"use client";

import { LeavesPage } from "@/components/leaves/leaves-page";
import { SignedIn } from "@/lib/current-user";

// /leaves : mon solde, une nouvelle demande de congé et mes congés (tous les rôles).
export default function LeavesRoute() {
  return <SignedIn>{() => <LeavesPage />}</SignedIn>;
}
