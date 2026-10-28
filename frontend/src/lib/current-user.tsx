"use client";

/*
 * La personne connectée, partagée par toutes les pages de l'application.
 *
 * Le layout de app/(app) demande /api/auth/me/ UNE fois (useMe) et la met ici. Chaque page la lit
 * avec useCurrentUser(), sans redemander à Django : on passe d'une page à l'autre sans "Loading...".
 * `me` vaut null seulement au tout premier affichage, le temps que Django réponde.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Me } from "./api";

type CurrentUser = { me: Me | null; logout: () => void };

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({ value, children }: { value: CurrentUser; children: ReactNode }) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

/** Dans une page de app/(app) : { me, logout } (me = null tant que Django n'a pas répondu). */
export function useCurrentUser() {
  const value = useContext(CurrentUserContext);
  if (value === null) {
    throw new Error("useCurrentUser() s'utilise seulement dans les pages de app/(app).");
  }
  return value;
}

/**
 * Le contenu d'une page, affiché seulement quand on sait qui est connecté (jamais avant :
 * pas de requête à l'API pour un visiteur non vérifié). Pendant ce temps : un petit "Loading...".
 *
 *   <SignedIn>{(me) => <EmployeeForm me={me} />}</SignedIn>
 */
export function SignedIn({ children }: { children: (me: Me) => ReactNode }) {
  const { me } = useCurrentUser();
  if (me === null) {
    return <p className="py-12 text-center text-sm text-slate-500">Loading...</p>;
  }
  return children(me);
}
