"use client";

import { WorkflowsManager } from "@/components/workflows/workflows-manager";
import { seesBothPoles } from "@/lib/api";
import { SignedIn } from "@/lib/current-user";

// /workflows : les circuits de validation et les DG, pour l'Admin RH et l'IT.
export default function WorkflowsPage() {
  return (
    <SignedIn>
      {(me) => seesBothPoles(me) ? (
        <WorkflowsManager />
      ) : (
        // Les autres rôles : un message (et Django refuse de toute façon : 403).
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-600">
          Only Admin RH can manage the workflows.
        </p>
      )}
    </SignedIn>
  );
}
