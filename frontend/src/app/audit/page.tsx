"use client";

import { AuditLog } from "@/components/audit/audit-log";
import { HrPage } from "@/components/employees/hr-page";

// /audit : le journal de tous les dossiers (RH : son pôle ; Admin RH et IT : tout).
export default function AuditPage() {
  return (
    <HrPage page="Audit log" active="Audit log">
      {() => <AuditLog />}
    </HrPage>
  );
}
