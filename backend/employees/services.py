import re
import unicodedata

from django.contrib.auth import get_user_model
from django.db import transaction


def clean_name(text):
    """'Fatima Ezzahra' -> 'fatima-ezzahra', 'Aït' -> 'ait': no accents, no spaces."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def make_username(first_name, last_name):
    """prénom.nom, then prénom.nom2, prénom.nom3... if it is already taken."""
    base = f"{clean_name(first_name)}.{clean_name(last_name)}"
    User = get_user_model()
    username, number = base, 1
    while User.objects.filter(username__iexact=username).exists():
        number += 1
        username = f"{base}{number}"
    return username


@transaction.atomic
def create_with_account(employee, role=None):
    """HR fills the fiche; the login account is created from it.
    Username = prénom.nom, temporary password = CIN (changed at first login).
    One transaction: if anything fails, neither the account nor the fiche exists."""
    User = get_user_model()
    employee.full_clean(exclude=["user"])  # check the fiche BEFORE creating the account
    employee.user = User.objects.create_user(
        make_username(employee.first_name, employee.last_name),
        password=employee.cin,
        email=employee.professional_email,
        role=role or User.Role.COLLABORATOR,
    )
    employee.save()
    return employee
