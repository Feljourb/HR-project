"""L'historique des dossiers (step F) : qui a changé quoi, et quand.

Utilisation (API, admin, "Mon profil") :
    before = history.snapshot(employee)          # 1. la photo AVANT
    ... on enregistre les changements ...
    history.record_changes(employee, actor, before)  # 2. on compare avec la photo APRÈS

    history.record(employee, actor, EmployeeHistory.Action.PASSWORD_RESET)  # une action simple
"""
from datetime import date

from .models import Employee, EmployeeHistory

# Pas enregistrés : l'id, le compte (voir "Changement de rôle") et le matricule (jamais modifié).
SKIPPED = {"id", "user", "u_number"}
# Secrets : on note QUE le champ a changé, jamais les numéros (l'historique est lu par plusieurs RH).
HIDDEN = {"rib", "cnss_number", "cimr_number"}
CHILDREN = "Enfants"


def display(employee, field):
    """La valeur d'un champ en texte lisible : "Mme" (pas "MME"), "Ventes" (pas 4), "02/04/2018"."""
    if field.choices:
        return getattr(employee, f"get_{field.name}_display")() or ""
    value = getattr(employee, field.name)
    if value is None:
        return ""
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    return str(value)


def snapshot(employee):
    """La "photo" du dossier : {libellé du champ: (nom technique, valeur en texte)}."""
    photo = {
        str(field.verbose_name): (field.name, display(employee, field))
        for field in Employee._meta.concrete_fields
        if field.name not in SKIPPED
    }
    # Les enfants sont dans une autre table : une ligne de texte, ex. "Yasmine (02/04/2018), Adam (15/09/2021)".
    photo[CHILDREN] = ("children", ", ".join(str(child) for child in employee.children.all()) if employee.pk else "")
    return photo


def diff(before, after):
    """Les champs qui ont changé entre deux photos."""
    changes = []
    for label, (name, old) in before.items():
        new = after[label][1]
        if old != new:
            changes.append({"field": label, "hidden": True} if name in HIDDEN else {"field": label, "old": old, "new": new})
    return changes


def record(employee, actor, action, changes=()):
    """Écrit une ligne d'historique. `actor` : le compte qui agit (None = le système)."""
    EmployeeHistory.objects.create(
        employee=employee,
        actor=actor if actor is not None and actor.is_authenticated else None,
        actor_name=getattr(actor, "username", "") or "système",
        action=action,
        changes=list(changes),
    )


def record_changes(employee, actor, before):
    """Compare avec la photo d'avant ; écrit une ligne seulement si quelque chose a changé."""
    changes = diff(before, snapshot(employee))
    if changes:
        record(employee, actor, EmployeeHistory.Action.UPDATED, changes)


def record_role(employee, actor, old_role_label, new_role_label):
    record(employee, actor, EmployeeHistory.Action.ROLE,
           [{"field": "Rôle du compte", "old": old_role_label, "new": new_role_label}])
