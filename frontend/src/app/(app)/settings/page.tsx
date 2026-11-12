"use client";

import { NotificationSettings } from "@/components/settings/notification-settings";
import { SignedIn } from "@/lib/current-user";

// /settings : MES réglages (pour tous les rôles) : les emails des notifications.
export default function SettingsPage() {
  return <SignedIn>{() => <NotificationSettings />}</SignedIn>;
}
