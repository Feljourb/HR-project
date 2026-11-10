"""P2 step 4 : les types qui demandent un justificatif dès le 1er jour (standard, à confirmer par les RH) :
- congé maladie : le certificat médical (le salarié prévient et l'envoie dans les 48 heures) ;
- congé de maternité : le certificat médical.
Les autres (annuel, sans solde, exceptionnels) : pas obligatoire (Admin RH peut le demander sur la page Lists)."""
from django.db import migrations


def set_documents(apps, schema_editor):
    LeaveType = apps.get_model("leaves", "LeaveType")
    LeaveType.objects.filter(name__in=["Congé maladie", "Congé de maternité"]).update(document_from_days=1)


class Migration(migrations.Migration):

    dependencies = [
        ("leaves", "0016_leave_documents"),
    ]

    operations = [
        migrations.RunPython(set_documents, migrations.RunPython.noop),
    ]
