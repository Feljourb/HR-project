"""Le circuit "Départ collaborateur" devient N+1 valide -> RH du pôle valide (2026-11-24, standard Workday
"Resign" : le collaborateur demande, son manager valide, puis les RH). Seulement si Admin RH ne l'a pas changé
(encore la seule étape "RH valide" de 0013). Les demandes déjà envoyées gardent leur copie du circuit.
Quand c'est le N+1 qui saisit le départ, sa saisie vaut son accord : son étape est passée (voir engine.submit)."""
from django.db import migrations


def manager_first(apps, schema_editor):
    Workflow = apps.get_model("workflows", "Workflow")
    workflow = Workflow.objects.filter(code="DEPARTURE").first()
    if workflow is None:
        return
    steps = list(workflow.steps.order_by("order").values_list("approver", "mode"))
    if steps != [("HR", "VALIDATE")]:
        return  # Admin RH a déjà choisi son circuit : on n'y touche pas
    workflow.steps.update(order=2)
    workflow.steps.create(order=1, approver="MANAGER", mode="VALIDATE")


def back(apps, schema_editor):
    Workflow = apps.get_model("workflows", "Workflow")
    workflow = Workflow.objects.filter(code="DEPARTURE").first()
    if workflow is not None and list(workflow.steps.order_by("order").values_list("approver", "mode")) == [
            ("MANAGER", "VALIDATE"), ("HR", "VALIDATE")]:
        workflow.steps.filter(order=1).delete()
        workflow.steps.update(order=1)


class Migration(migrations.Migration):
    dependencies = [("workflows", "0013_departure_circuit")]
    operations = [migrations.RunPython(manager_first, back)]
