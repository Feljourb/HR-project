"use client";

/*
 * Le cadre commun de toutes les pages connectées (accueil, profil, annuaire, collaborateurs...).
 *
 * (app) entre parenthèses : un "route group". Il n'apparaît pas dans l'adresse (/employees reste
 * /employees), il sert seulement à partager CE layout. Next.js garde le layout affiché quand on
 * change de page : la sidebar et le header ne sont plus effacés puis redessinés, seul le contenu change.
 *
 * Le cadre ET la page sont toujours dessinés, même avant la réponse de Django (me = null) :
 * le cadre montre des zones grises à la place du nom, et chaque page attend avec <SignedIn>.
 * (Next.js vérifie ainsi que chaque page peut s'afficher instantanément.)
 *
 * Les pages sans cadre (login, change-password, mfa-setup) sont en dehors de (app).
 */
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { CurrentUserProvider } from "@/lib/current-user";
import { useMe } from "@/lib/use-me";

export default function AppLayout({ children }: { children: ReactNode }) {
  // Une seule fois pour toute l'application : qui est connecté ? (sinon -> /login, voir useMe)
  const { me, logout } = useMe();

  return (
    <CurrentUserProvider value={{ me, logout }}>
      <AppShell me={me} onLogout={logout}>
        {children}
      </AppShell>
    </CurrentUserProvider>
  );
}
