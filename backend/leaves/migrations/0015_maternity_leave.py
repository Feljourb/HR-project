"""P2 step 3 : le congé de maternité (Code du travail : 14 semaines = 98 jours), compté en jours CALENDAIRES
(chaque jour compte, même le dimanche et les fériés), pas pris sur le solde. Standard, à confirmer par les RH.
7 jours dans le passé : il commence souvent à la naissance (les RH peuvent aussi l'enregistrer).
Créé seulement s'il n'existe pas déjà (Admin RH a pu l'ajouter à la main)."""
from decimal import Decimal

from django.db import migrations


def add_maternity(apps, schema_editor):
    LeaveType = apps.get_model("leaves", "LeaveType")
    if not LeaveType.objects.filter(name__iexact="Congé de maternité").exists():
        LeaveType.objects.create(name="Congé de maternité", deducts_balance=False, max_days=Decimal("98"),
                                 max_days_back=7, counting="CALENDAR")


class Migration(migrations.Migration):

    dependencies = [
        ("leaves", "0014_leave_type_counting"),
    ]

    operations = [
        migrations.RunPython(add_maternity, migrations.RunPython.noop),
    ]
