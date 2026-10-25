"""Logique métier des collaborateurs.

On la met ici (et pas dans l'admin ou dans une vue) pour que l'admin Django,
l'API et un futur import Excel utilisent exactement les mêmes règles.
"""
import re
import unicodedata

from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction


def sees_both_poles(user):
    """Admin RH et IT voient (et gèrent) les deux pôles."""
    return user.is_superuser or user.role == get_user_model().Role.HR_ADMIN


def limited_to_own_pole(user):
    """Un RH (pas Admin RH, pas IT) ne voit que son pôle."""
    return user.role == get_user_model().Role.HR and not user.is_superuser


def user_pole(user):
    """Le pôle d'un utilisateur, lu dans son propre dossier RH (user.employee.pole).
    Renvoie None si l'utilisateur n'a pas encore de dossier (ex. un compte IT)."""
    try:
        return user.employee.pole
    except ObjectDoesNotExist:
        return None


def clean_name(text):
    """Transforme un nom en morceau de username : minuscules, sans accents, sans espaces.
    Exemples : "Fatima Ezzahra" -> "fatima-ezzahra", "Aït Taleb" -> "ait-taleb"."""
    # NFKD sépare la lettre de son accent ("ï" -> "i" + "¨"), puis encode("ascii", "ignore")
    # jette les accents qui ne sont pas de l'ASCII.
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    # Tout ce qui n'est pas une lettre ou un chiffre (espace, apostrophe...) devient un "-".
    # strip("-") enlève les "-" au début et à la fin.
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def make_username(first_name, last_name):
    """Construit le username au format prénom.nom.
    S'il est déjà pris, on ajoute un numéro : ahmed.alami, ahmed.alami2, ahmed.alami3..."""
    base = f"{clean_name(first_name)}.{clean_name(last_name)}"
    User = get_user_model()
    username, number = base, 1
    # iexact : "Ahmed.Alami" et "ahmed.alami" comptent comme le même username.
    while User.objects.filter(username__iexact=username).exists():
        number += 1
        username = f"{base}{number}"
    return username


@transaction.atomic
def create_with_account(employee, role=None):
    """Enregistre un nouveau dossier ET crée son compte de connexion.

    - username = prénom.nom (voir make_username)
    - mot de passe temporaire = CIN (en majuscules) ; le changement au premier
      login vient de must_change_password=True (valeur par défaut du modèle User)
    - rôle = Collaborateur, sauf si on en donne un autre

    @transaction.atomic : tout se fait dans une seule transaction. Si une étape
    échoue, PostgreSQL annule tout : jamais de compte sans dossier (ou l'inverse).
    """
    User = get_user_model()

    # 1. On vérifie le dossier AVANT de créer le compte (poste du bon service, CIN unique...).
    #    exclude=["user"] : le compte n'existe pas encore, on ne le vérifie pas.
    employee.full_clean(exclude=["user"])

    # 2. Le compte de connexion (create_user chiffre le mot de passe, jamais en clair en base).
    employee.user = User.objects.create_user(
        make_username(employee.first_name, employee.last_name),
        password=employee.cin,
        email=employee.professional_email,
        role=role or User.Role.COLLABORATOR,
    )

    # 3. Le dossier lui-même ; save() crée aussi le matricule.
    employee.save()
    return employee
