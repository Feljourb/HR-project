"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { EmployeeForm } from "@/components/employees/employee-form";
import { EmployeeHistory } from "@/components/employees/employee-history";
import { HrPage } from "@/components/employees/hr-page";
import type { Me } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// /employees/7 : voir et modifier le dossier n°7. [id] dans le nom du dossier = la partie variable de l'adresse.
// Deux onglets : la fiche (File) et son historique (History).
export default function EmployeePage() {
  return (
    <HrPage page="Employee file">
      {(me) => (
        // Suspense : obligatoire autour de useParams (lecture du numéro dans l'adresse), comme l'annuaire.
        <Suspense fallback={<p className="py-12 text-center text-sm text-slate-500">Loading...</p>}>
          <EmployeeFromAddress me={me} />
        </Suspense>
      )}
    </HrPage>
  );
}

function EmployeeFromAddress({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const employeeId = Number(id);

  if (!Number.isInteger(employeeId)) {
    return <p className="py-12 text-center text-sm text-slate-500">This employee does not exist.</p>;
  }

  // key : si on passe d'un dossier à un autre, tout repart de zéro.
  return (
    <Tabs key={employeeId} defaultValue="file">
      <TabsList>
        <TabsTrigger value="file">File</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      {/* keepMounted : en passant sur History, le formulaire reste en mémoire (rien n'est perdu). */}
      <TabsContent value="file" keepMounted>
        <EmployeeForm me={me} employeeId={employeeId} />
      </TabsContent>
      {/* Sans keepMounted : l'historique est rechargé à chaque ouverture de l'onglet. */}
      <TabsContent value="history">
        <EmployeeHistory employeeId={employeeId} />
      </TabsContent>
    </Tabs>
  );
}
