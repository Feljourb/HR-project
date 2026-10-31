import re
import unicodedata

from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import transaction

from .models import Employee


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


def make_email(first_name, last_name, department):
    """L'email professionnel d'un NOUVEAU collaborateur : 1re lettre du prénom + "." + nom + domaine du pôle.
    "Fatima", "El Alami", un service de SBD -> "f.el-alami@silent-believers.com" (déjà pris -> "f.el-alami2@...").
    Renvoie "" s'il manque le prénom, le nom ou le service : leurs propres erreurs s'affichent."""
    first, last = clean_name(first_name), clean_name(last_name)
    if not (first and last and department):
        return ""
    pole = department.direction.entity.pole
    if not pole.email_domain:
        raise ValidationError({"professional_email": f"Le pôle {pole} n'a pas de domaine email (à remplir dans l'admin)."})

    base =f"{first[0]}.{last}"
    email, number = f"{base}@{pole.email_domain}", 1
    while email_taken(email):  # déjà pris : on ajoute un numéro
        number += 1
        email = f"{base}{number}@{pole.email_domain}"
    return email


def email_taken(email, employee=None):
    """L'adresse est-elle déjà utilisée par un AUTRE dossier ou un AUTRE compte (ex. un Admin RH sans dossier) ?
    `employee` : le dossier qu'on modifie, qui a le droit de garder sa propre adresse."""
    employees = Employee.objects.filter(professional_email__iexact=email)
    users = get_user_model().objects.filter(email__iexact=email)
    if employee is not None and employee.pk:
        employees = employees.exclude(pk=employee.pk)
        users = users.exclude(pk=employee.user_id)
    return employees.exists() or users.exists()


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
