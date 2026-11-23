"""Les tâches de départ du modèle : une PROPOSITION standard (BambooHR, Workday), à valider par les RH.
Admin RH les change dans Reference lists -> Arrivées et départs (nom, qui, quand, information à noter).
L'IT et le parc auto sont des tâches "RH du pôle" tant qu'Admin RH n'a pas choisi la personne (owner PERSON)."""
from django.db import migrations

ARRIVAL = [
    # (tâche, qui, jours depuis le premier jour, information à noter)
    ("Préparer le contrat de travail", "HR", -5, ""),
    ("Préparer le PC et créer l'email professionnel", "HR", -3, "Numéro de série du PC"),
    ("Préparer le badge d'accès", "HR", -2, "Numéro du badge"),
    ("Préparer le bureau et choisir un parrain", "MANAGER", -1, "Parrain"),
    ("Accueil et présentation de l'entreprise", "HR", 0, ""),
    ("Apporter les documents : CIN, RIB, photo, diplômes", "EMPLOYEE", 0, ""),
    ("Point de fin du premier mois", "MANAGER", 30, ""),
]

DEPARTURE = [
    ("Solde de tout compte : congés restants, dernier salaire", "HR", -5, ""),
    ("Passation : transmettre les dossiers en cours", "MANAGER", -5, "Repris par"),
    ("Entretien de sortie", "HR", -3, ""),
    ("Préparer le certificat de travail", "HR", -2, ""),
    ("Récupérer le PC et le téléphone", "HR", 0, "Numéro de série du PC"),
    ("Récupérer la voiture de service (s'il y en a une)", "HR", 0, "Immatriculation"),
    ("Récupérer le badge d'accès", "HR", 0, "Numéro du badge"),
    ("Fermer l'email et les accès", "HR", 0, ""),
]


def add(apps, schema_editor):
    TaskTemplate = apps.get_model("journeys", "TaskTemplate")
    for kind, rows in (("ARRIVAL", ARRIVAL), ("DEPARTURE", DEPARTURE)):
        for name, owner, offset, detail in rows:
            TaskTemplate.objects.get_or_create(kind=kind, name=name,
                                               defaults={"owner": owner, "offset_days": offset, "detail_label": detail})


class Migration(migrations.Migration):
    dependencies = [("journeys", "0001_journeys")]
    operations = [migrations.RunPython(add, migrations.RunPython.noop)]
