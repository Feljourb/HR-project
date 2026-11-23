"""Le circuit "Départ collaborateur" (2026-11-23) : les RH du pôle valident (standard ; Admin RH peut le changer
dans Workflows). Après la validation, l'app journeys commence les tâches du départ."""
from django.db import migrations, models


def create_circuit(apps, schema_editor):
    Workflow = apps.get_model("workflows", "Workflow")
    WorkflowStep = apps.get_model("workflows", "WorkflowStep")
    workflow, created = Workflow.objects.get_or_create(code="DEPARTURE", defaults={"name": "Départ collaborateur"})
    if created:
        WorkflowStep.objects.create(workflow=workflow, order=1, approver="HR", mode="VALIDATE")


class Migration(migrations.Migration):
    dependencies = [("workflows", "0012_notification_policy")]
    operations = [
        migrations.AlterField(
            model_name="workflow", name="code",
            field=models.CharField(choices=[("LEAVE", "Congé"), ("EXPENSE", "Note de frais"), ("ADMIN_REQUEST", "Demande administrative"),
                                            ("DEPARTURE", "Départ collaborateur")], max_length=30, unique=True, verbose_name="Code"),
        ),
        migrations.RunPython(create_circuit, migrations.RunPython.noop),
    ]
