"use client";

import { MyRequests } from "@/components/requests/my-requests";
import { SignedIn } from "@/lib/current-user";

// /requests : mes demandes (tous les rôles ; Django ne renvoie que les miennes).
export default function RequestsPage() {
  return <SignedIn>{() => <MyRequests />}</SignedIn>;
}
