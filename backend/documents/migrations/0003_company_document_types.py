"""Les types de document de la société (liste donnée par l'utilisateur le 2026-11-12, capture de l'outil actuel) :
- "Domiciliation de salaire" s'appelle "Attestation de domiciliation bancaire" (renommée : ses demandes la gardent) ;
- 3 types en plus : attestation de stage, duplicata du bulletin de paie, relevé / attestation CNSS.
Tous préparés par les RH, sauf l'attestation de travail (générée par l'application). Rien n'est supprimé."""
from django.db import migrations

NEW_TYPES = ["Attestation de stage", "Duplicata bulletin de paie", "Relevé / attestation CNSS"]


def update_types(apps, schema_editor):
    DocumentType = apps.get_model("documents", "DocumentType")
    DocumentType.objects.filter(name="Domiciliation de salaire").update(name="Attestation de domiciliation bancaire")
    for name in NEW_TYPES:
        DocumentType.objects.get_or_create(name=name, defaults={"template": ""})


def undo(apps, schema_editor):
    DocumentType = apps.get_model("documents", "DocumentType")
    DocumentType.objects.filter(name="Attestation de domiciliation bancaire").update(name="Domiciliation de salaire")


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0002_initial_values'),
    ]

    operations = [
        migrations.RunPython(update_types, undo),
    ]
