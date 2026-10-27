"""Actions sur les comptes, utilisées par les vues, l'admin et l'app employees."""
import secrets

from django.db import transaction
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .models import User

# Lettres et chiffres SANS les caractères qu'on confond à l'oral ou à l'écrit
# (0/O, 1/l/I) : le RH doit pouvoir dicter le mot de passe au collaborateur.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def logout_everywhere(user):
    """Ferme toutes les sessions du compte : chaque refresh token est mis sur liste noire.

    Limite : un access token déjà donné reste valable jusqu'à sa fin (15 minutes max),
    puis le navigateur ne peut plus en obtenir un nouveau."""
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


def set_account_active(user, active):
    """Bloque (active=False) ou débloque un compte (ex. collaborateur "Sorti", puis réintégré).

    Bloqué : la connexion est refusée, ET un access token déjà donné ne marche plus tout de
    suite (simplejwt relit is_active à chaque requête). On ferme aussi toutes ses sessions."""
    if user.is_active == active:
        return
    user.is_active = active
    user.save(update_fields=["is_active"])
    if not active:
        logout_everywhere(user)


def generate_temporary_password():
    """Un mot de passe aléatoire lisible, ex. "Kp7m-Xr4t-Qz9w".
    secrets (et pas random) : fait pour la sécurité, impossible à prévoir."""
    groups = ["".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3)]
    return "-".join(groups)


def can_reset_password(actor, target):
    """Qui peut réinitialiser le mot de passe de qui (la même règle pour l'API, le frontend et l'admin).

    - IT (superuser) : tout le monde.
    - Un compte IT ou Admin RH : seulement l'IT (connaître son mot de passe = prendre ses droits).
    - Un compte RH : seulement l'Admin RH (un RH ne prend pas la main sur un autre RH).
    - Les autres comptes : RH et Admin RH (le pôle du RH est vérifié par l'API, voir EmployeeViewSet).
    - Un compte bloqué (collaborateur "Sorti") : personne. Il ne peut pas se connecter de toute façon.
    """
    if not target.is_active:
        return False
    if actor.is_superuser:
        return True
    if target.is_superuser or target.role == User.Role.HR_ADMIN:
        return False
    if target.role == User.Role.HR:
        return actor.role == User.Role.HR_ADMIN
    return actor.role in (User.Role.HR, User.Role.HR_ADMIN)


def can_change_role(actor, target, new_role):
    """Qui peut donner quel rôle à quel compte existant (la même règle pour l'API et le frontend).

    - Personne ne change SON PROPRE rôle (sinon un RH se donnerait plus de droits).
    - IT (superuser) : tous les autres comptes.
    - Un compte IT : seulement l'IT.
    - Donner ou retirer le rôle Admin RH : seulement l'IT. Chacun donne des rôles EN DESSOUS du
      sien, jamais le sien : un compte Admin RH volé ne peut pas créer d'autres Admin RH.
    - Donner ou retirer le rôle RH : Admin RH.
    - RH : Collaborateur <-> Manager (le pôle du RH est vérifié par l'API, voir EmployeeViewSet).
    """
    if actor.pk == target.pk:
        return False
    if actor.is_superuser:
        return True
    if target.is_superuser:
        return False
    if User.Role.HR_ADMIN in (new_role, target.role):
        return False
    if User.Role.HR in (new_role, target.role):
        return actor.role == User.Role.HR_ADMIN
    return actor.role in (User.Role.HR, User.Role.HR_ADMIN)


def can_give_role_to_new_account(actor, role):
    """À la création d'une fiche : la même échelle que can_change_role.
    Admin RH : seulement l'IT. RH : Admin RH (et l'IT). Manager / Collaborateur : tous les RH."""
    if actor.is_superuser:
        return True
    if role == User.Role.HR_ADMIN:
        return False
    if role == User.Role.HR:
        return actor.role == User.Role.HR_ADMIN
    return actor.role in (User.Role.HR, User.Role.HR_ADMIN)


@transaction.atomic
def reset_password(user):
    """Le collaborateur a oublié son mot de passe.

    1. Nouveau mot de passe temporaire aléatoire (pas le CIN : il est déjà connu de tous).
    2. must_change_password = True : il devra le changer à la prochaine connexion.
    3. Toutes ses sessions sont fermées (quelqu'un d'autre est peut-être connecté).
    Renvoie le mot de passe EN CLAIR, à montrer une seule fois au RH (la base n'en garde que le hash).
    """
    password = generate_temporary_password()
    user.set_password(password)
    user.must_change_password = True
    user.save(update_fields=["password", "must_change_password"])
    logout_everywhere(user)
    return password
