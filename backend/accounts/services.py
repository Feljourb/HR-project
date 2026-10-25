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


def generate_temporary_password():
    """Un mot de passe aléatoire lisible, ex. "Kp7m-Xr4t-Qz9w".
    secrets (et pas random) : fait pour la sécurité, impossible à prévoir."""
    groups = ["".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3)]
    return "-".join(groups)


def can_reset_password(actor, target):
    """Qui peut réinitialiser le mot de passe de qui (la même règle pour l'API, le frontend et l'admin).

    - IT (superuser) : tout le monde.
    - Un compte IT : seulement l'IT (sinon un Admin RH connaîtrait le mot de passe de l'IT).
    - Un compte RH ou Admin RH : seulement l'Admin RH (un RH ne prend pas la main sur un autre RH).
    - Les autres comptes : RH et Admin RH (le pôle du RH est vérifié par l'API, voir EmployeeViewSet).
    """
    if actor.is_superuser:
        return True
    if target.is_superuser:
        return False
    if target.role in (User.Role.HR, User.Role.HR_ADMIN):
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
