"use client";

import { ExpensesPage } from "@/components/expenses/expenses-page";
import { SignedIn } from "@/lib/current-user";

// /expenses : mes notes de frais, une nouvelle note et le barème (tous les rôles).
export default function ExpensesRoute() {
  return <SignedIn>{(me) => <ExpensesPage me={me} />}</SignedIn>;
}
