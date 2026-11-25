"""La procédure de départ complète (2026-11-25), valeurs STANDARD par défaut (à valider par les RH, tout se change dans
Réglages des arrivées et départs) :
- le type de document "Reçu pour solde de tout compte" (préparé par la paie, déposé par les RH ; art. 73) ;
- les documents de sortie demandés tout seuls : certificat de travail (art. 72) + reçu pour solde de tout compte ;
- 5 questions d'entretien de sortie (les questions standard : pourquoi, le manager, l'ambiance, quoi améliorer,
  recommanderiez-vous) ;
- une tâche de départ "Déclarer la sortie à la CNSS (Damancom)" (les RH ; Damancom n'a pas d'API : l'app donne les
  informations, les RH déclarent)."""
from django.db import migrations

QUESTIONS = [
    ("Quelle est la raison principale de votre départ ?", "CHOICE",
     ["Salaire", "Évolution de carrière", "Relation avec le manager", "Ambiance de travail", "Charge de travail",
      "Raisons personnelles / familiales", "Déménagement", "Autre"], True),
    ("Comment notez-vous la relation avec votre manager ?", "RATING", [], False),
    ("Comment notez-vous l'ambiance de travail ?", "RATING", [], False),
    ("Qu'est-ce que l'entreprise pourrait améliorer ?", "TEXT", [], False),
    ("Recommanderiez-vous l'entreprise à un ami ?", "YES_NO", [], False),
]


def defaults(apps, schema_editor):
    DocumentType = apps.get_model("documents", "DocumentType")
    receipt = DocumentType.objects.filter(name__iexact="Reçu pour solde de tout compte").first()
    if receipt is None:
        receipt = DocumentType.objects.create(name="Reçu pour solde de tout compte", template="", delivery_days=2)
    certificate = DocumentType.objects.filter(name__iexact="Certificat de travail").first()
    JourneySettings = apps.get_model("journeys", "JourneySettings")
    current, _ = JourneySettings.objects.get_or_create(pk=1)
    if not current.exit_document_types.exists():
        current.exit_document_types.set([doc for doc in (certificate, receipt) if doc is not None])

    ExitQuestion = apps.get_model("journeys", "ExitQuestion")
    if not ExitQuestion.objects.exists():
        for order, (text, kind, choices, required) in enumerate(QUESTIONS, start=1):
            ExitQuestion.objects.create(text=text, kind=kind, choices=choices, required=required, order=order)

    TaskTemplate = apps.get_model("journeys", "TaskTemplate")
    TaskTemplate.objects.get_or_create(kind="DEPARTURE", name="Déclarer la sortie à la CNSS (Damancom)",
                                       defaults={"owner": "HR", "offset_days": 5, "detail_label": "Date de la déclaration"})


class Migration(migrations.Migration):
    dependencies = [
        ("journeys", "0008_exit_procedure"),
        ("documents", "0020_hr_always_sees_before_sending"),
    ]
    operations = [migrations.RunPython(defaults, migrations.RunPython.noop)]
