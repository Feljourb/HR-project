"use client";

import { HrDocuments } from "@/components/documents/hr-documents";
import { SignedIn } from "@/lib/current-user";

// /document-requests : les demandes de document du pôle, à préparer (RH ; Admin RH et IT : les deux pôles).
export default function DocumentRequestsRoute() {
  return <SignedIn>{() => <HrDocuments />}</SignedIn>;
}
