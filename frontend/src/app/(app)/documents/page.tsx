"use client";

import { DocumentsPage } from "@/components/documents/documents-page";
import { SignedIn } from "@/lib/current-user";

// /documents : demander un document administratif et le télécharger (tous les rôles ; Django ne renvoie que les miens).
export default function AdministrativeDocumentsPage() {
  return <SignedIn>{() => <DocumentsPage />}</SignedIn>;
}
