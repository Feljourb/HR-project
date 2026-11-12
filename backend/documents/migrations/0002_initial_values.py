"""Les valeurs de départ (PROPOSITION standard, à valider par les RH comme les autres listes ; Admin RH peut les
changer, jamais supprimer : désactiver) :
- 6 types de document. Seule l'attestation de travail est GÉNÉRÉE par l'application (tout est dans la fiche) ;
  les autres sont préparés par les RH (ex. le salaire n'est pas dans l'application) ;
- un signataire par pôle : "Le Directeur des Ressources Humaines", fait à Casablanca (nom vide), à confirmer."""
from django.db import migrations

# (nom, modèle : "WORK" = généré par l'application, "" = préparé par les RH)
TYPES = [
    ("Attestation de travail", "WORK"),
    ("Attestation de salaire", ""),
    ("Domiciliation de salaire", ""),
    ("Attestation de congé", ""),
    ("Certificat de travail", ""),  # à la sortie (Code du travail, art. 72)
    ("Autre document", ""),
]


def create_values(apps, schema_editor):
    DocumentType = apps.get_model("documents", "DocumentType")
    DocumentSignatory = apps.get_model("documents", "DocumentSignatory")
    Pole = apps.get_model("employees", "Pole")
    for name, template in TYPES:
        DocumentType.objects.get_or_create(name=name, defaults={"template": template})
    for pole in Pole.objects.all():
        DocumentSignatory.objects.get_or_create(pole=pole)


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0001_documents'),
    ]

    operations = [
        # Au retour, les tables sont supprimées par 0001 : rien à défaire ici.
        migrations.RunPython(create_values, migrations.RunPython.noop),
    ]
