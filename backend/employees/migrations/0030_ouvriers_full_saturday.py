"""Le samedi dans les congés (2026-11-10) : les fiches EXISTANTES de catégorie "Ouvrier" passent à "journée entière"
(ils travaillent tout le samedi à l'usine) ; les autres gardent ½ journée. Les RH corrigent une exception sur la fiche."""
from django.db import migrations


def ouvriers_full_saturday(apps, schema_editor):
    Employee = apps.get_model("employees", "Employee")
    Employee.objects.filter(category__name__iexact="Ouvrier").update(saturday_work="FULL")


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0029_saturday_work"),
    ]

    operations = [
        migrations.RunPython(ouvriers_full_saturday, migrations.RunPython.noop),
    ]
