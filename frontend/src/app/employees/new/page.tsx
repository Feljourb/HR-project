"use client";

import { EmployeeForm } from "@/components/employees/employee-form";
import { HrPage } from "@/components/employees/hr-page";

// /employees/new : créer un collaborateur (et son compte).
export default function NewEmployeePage() {
  return <HrPage page="New employee">{(me) => <EmployeeForm me={me} />}</HrPage>;
}
