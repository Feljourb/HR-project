"""P1 step 4 : les valeurs de départ de "jours dans le passé autorisés" (standard, à confirmer par les RH) :
- congé maladie : 2 jours (le salarié prévient dans les 48 heures) ;
- congés exceptionnels (mariage, naissance, décès...) : 7 jours (on les demande souvent après l'événement) ;
- les autres (annuel, sans solde, et les types ajoutés par Admin RH) gardent 0 : ils se planifient avant.
"""
from django.db import migrations


def set_days_back(apps, schema_editor):
    LeaveType = apps.get_model("leaves", "LeaveType")
    LeaveType.objects.filter(name="Congé maladie").update(max_days_back=2)
    LeaveType.objects.filter(name__startswith="Congé exceptionnel").update(max_days_back=7)


class Migration(migrations.Migration):

    dependencies = [
        ("leaves", "0011_leave_type_days_back"),
    ]

    operations = [
        migrations.RunPython(set_days_back, migrations.RunPython.noop),
    ]
