"use client";

import { MyTasks } from "@/components/journeys/my-tasks";
import { SignedIn } from "@/lib/current-user";

// /my-tasks : MES tâches pour préparer une arrivée ou un départ (tout le monde).
export default function MyTasksRoute() {
  return <SignedIn>{() => <MyTasks />}</SignedIn>;
}
