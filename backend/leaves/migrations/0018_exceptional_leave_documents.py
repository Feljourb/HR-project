"""P2 step 4 (remarque de l'utilisateur, 2026-11-10) : les congés EXCEPTIONNELS demandent aussi un justificatif
(standard : acte de mariage, extrait d'acte de naissance, acte de décès, certificat...), dès le 1er jour.
À confirmer par les RH (Admin RH peut changer "Document from (days)" sur la page Lists)."""
from django.db import migrations


def set_documents(apps, schema_editor):
    LeaveType = apps.get_model("leaves", "LeaveType")
    LeaveType.objects.filter(name__startswith="Congé exceptionnel", document_from_days__isnull=True).update(document_from_days=1)


class Migration(migrations.Migration):

    dependencies = [
        ("leaves", "0017_document_initial_values"),
    ]

    operations = [
        migrations.RunPython(set_documents, migrations.RunPython.noop),
    ]
