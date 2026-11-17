"use client";

import { Suspense } from "react";
import { DocumentsPage } from "@/components/documents/documents-page";
import { SignedIn } from "@/lib/current-user";

// /documents : demander un document administratif et le télécharger (tous les rôles ; Django ne renvoie que les miens).
// <Suspense> : la page lit l'adresse (?open=<demande>, le lien de la cloche "Document prêt" : la demande s'ouvre).
export default function AdministrativeDocumentsPage() {
  return <Suspense fallback={null}><SignedIn>{(me) => <DocumentsPage me={me} />}</SignedIn></Suspense>;
}
