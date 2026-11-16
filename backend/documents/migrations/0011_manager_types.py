"""Les types que le manager peut demander pour son équipe (2026-11-16, PROPOSITION standard ; Admin RH change sur la
page Lists) : l'attestation de travail seulement. Pas l'attestation de salaire, la domiciliation, le relevé CNSS
ou le bulletin de paie : ils montrent le salaire, qui ne regarde pas le manager."""
from django.db import migrations


def set_types(apps, schema_editor):
    DocumentType = apps.get_model("documents", "DocumentType")
    DocumentType.objects.filter(name="Attestation de travail").update(manager_can_request=True)


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0010_manager_can_request'),
    ]

    operations = [
        migrations.RunPython(set_types, migrations.RunPython.noop),
    ]
