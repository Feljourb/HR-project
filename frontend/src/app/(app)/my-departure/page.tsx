"use client";

import { MyDeparture } from "@/components/journeys/my-departure";
import { SignedIn } from "@/lib/current-user";

// /my-departure : MA demande de départ (seulement si Admin RH le permet).
export default function MyDepartureRoute() {
  return <SignedIn>{() => <MyDeparture />}</SignedIn>;
}
