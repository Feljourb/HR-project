"use client";

import { Suspense } from "react";
import { ExpensesPage } from "@/components/expenses/expenses-page";
import { SignedIn } from "@/lib/current-user";

// /expenses : mes notes de frais, une nouvelle note et le barème (tous les rôles).
// <Suspense> : la page lit l'adresse (?open=<demande>, le lien de la cloche : la note s'ouvre dans le panneau).
export default function ExpensesRoute() {
  return <Suspense fallback={null}><SignedIn>{(me) => <ExpensesPage me={me} />}</SignedIn></Suspense>;
}
