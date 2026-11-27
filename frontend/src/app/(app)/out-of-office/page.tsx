"use client";

import { OutOfOfficePage } from "@/components/requests/out-of-office";
import { SignedIn } from "@/lib/current-user";

// /out-of-office (2026-11-27) : je pars, qui répond à ma place ; je remplace quelqu'un ; l'historique.
export default function OutOfOfficeRoute() {
  return <SignedIn>{(me) => <OutOfOfficePage me={me} />}</SignedIn>;
}
