"use client";

import { EmployeeTable } from "@/components/employees/employee-table";
import { HrPage } from "@/components/employees/hr-page";

// /employees : le tableau des collaborateurs (RH, Admin RH, IT).
export default function EmployeesPage() {
  return <HrPage page="Employees">{() => <EmployeeTable />}</HrPage>;
}
