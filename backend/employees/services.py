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

    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def make_username(first_name, last_name):
    
    base = f"{clean_name(first_name)}.{clean_name(last_name)}"
    User = get_user_model()
    username, number = base, 1

    while User.objects.filter(username__iexact=username).exists():
        number += 1
        username = f"{base}{number}"
    return username


@transaction.atomic
def create_with_account(employee, role=None):
    """Enregistre un nouveau dossier ET crée son compte de connexion."""


    User = get_user_model()

    employee.full_clean(exclude=["user"])

    employee.user = User.objects.create_user(
        make_username(employee.first_name, employee.last_name),
        password=employee.cin,
        email=employee.professional_email,
        role=role or User.Role.COLLABORATOR,
    )

    employee.save()
    return employee
