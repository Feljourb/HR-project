"""Les 3 circuits de départ (validés par l'encadrant). Admin RH pourra changer les étapes ensuite."""
from django.db import migrations

# code, nom, étapes [(valideur, mode), ...] dans l'ordre.
CIRCUITS = [
    ("LEAVE", "Congé", [("MANAGER", "VALIDATE"), ("HR", "INFORM")]),
    # Après validation : le collaborateur imprime et la donne à la RH paie (hors plateforme).
    ("EXPENSE", "Note de frais", [("MANAGER", "VALIDATE")]),
    # Après validation : un PDF, ou "prête à retirer" (logique du futur module).
    ("ADMIN_REQUEST", "Demande administrative", [("HR", "VALIDATE")]),
]


def create_circuits(apps, schema_editor):
    # apps.get_model : le modèle tel qu'il est À CETTE migration (pas celui de models.py aujourd'hui).
    Workflow = apps.get_model("workflows", "Workflow")
    WorkflowStep = apps.get_model("workflows", "WorkflowStep")
    for code, name, steps in CIRCUITS:
        workflow = Workflow.objects.create(code=code, name=name)
        for order, (approver, mode) in enumerate(steps, start=1):
            WorkflowStep.objects.create(workflow=workflow, order=order, approver=approver, mode=mode)


def delete_circuits(apps, schema_editor):
    # Seulement pour annuler la migration (migrate workflows 0001) : les étapes partent avec (CASCADE).
    apps.get_model("workflows", "Workflow").objects.filter(code__in=[code for code, _, _ in CIRCUITS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("workflows", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_circuits, delete_circuits),
    ]
