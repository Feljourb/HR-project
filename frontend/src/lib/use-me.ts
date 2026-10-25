"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, nextPage, type Me } from "./api";

/**
 * Qui est connecté ? À utiliser en haut de chaque page protégée.
 *
 * - Demande /api/auth/me/ à Django.
 * - Pas connecté -> /login. Mot de passe à changer ou MFA à activer -> cette page d'abord.
 * - Renvoie `me` (null pendant le chargement) et `logout`.
 */
export function useMe() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch("/api/auth/me/")
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const user: Me = await response.json();
        if (nextPage(user) !== "/") {
          router.replace(nextPage(user)); // changer le mot de passe ou activer le MFA d'abord
          return;
        }
        setMe(user);
      })
      .catch(() => router.replace("/login"));

    // Next.js garde la page en vie (cachée) quand on la quitte. Ce "cleanup" s'exécute
    // à ce moment-là : on oublie l'utilisateur, pour que la personne suivante sur ce
    // navigateur ne voie jamais, même une seconde, la page de l'ancien utilisateur.
    return () => setMe(null);
  }, [router]);

  async function logout() {
    await apiFetch("/api/auth/logout/", { method: "POST" });
    router.replace("/login");
  }

  return { me, logout };
}
