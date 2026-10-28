"use client";

import { MyProfile } from "@/components/profile/my-profile";
import { SignedIn } from "@/lib/current-user";

// /profile : "Mon profil", pour tous les rôles (chacun voit seulement SON dossier).
export default function ProfilePage() {
  return <SignedIn>{() => <MyProfile />}</SignedIn>;
}
