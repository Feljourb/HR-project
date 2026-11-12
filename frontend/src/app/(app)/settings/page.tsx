"use client";

import { SettingsPage } from "@/components/settings/settings-page";
import { SignedIn } from "@/lib/current-user";

// /settings : MES réglages (pour tous les rôles) : les notifications, le mot de passe... (une section à la fois).
export default function SettingsRoute() {
  return <SignedIn>{() => <SettingsPage />}</SignedIn>;
}
