"use client";

import { useParams } from "next/navigation";
import { EmployeeForm } from "@/components/employees/employee-form";
import { HrPage } from "@/components/employees/hr-page";

// /employees/7 : voir et modifier le dossier n°7. [id] dans le nom du dossier = la partie variable de l'adresse.
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const employeeId = Number(id);

  return (
    <HrPage page="Employee file">
      {(me) => Number.isInteger(employeeId)
        // key : si on passe d'un dossier à un autre, le formulaire repart de zéro.
        ? <EmployeeForm key={employeeId} me={me} employeeId={employeeId} />
        : <p className="py-12 text-center text-sm text-slate-500">This employee does not exist.</p>}
    </HrPage>
  );
}
