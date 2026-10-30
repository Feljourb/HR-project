"use client";

import { SecuritySettingsPage } from "@/components/security/security-settings";
import { SignedIn } from "@/lib/current-user";

// /security : les réglages de sécurité (MFA, changement de mot de passe), pour l'IT seulement.
export default function SecurityPage() {
  return (
    <SignedIn>
      {(me) => me.is_superuser ? (
        <SecuritySettingsPage />
      ) : (
        // Les autres rôles : un message (et Django refuse de toute façon : 403).
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-600">
          Only IT can manage the security settings.
        </p>
      )}
    </SignedIn>
  );
}
