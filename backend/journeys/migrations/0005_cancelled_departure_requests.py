"""(2026-11-24) Avant ce jour, annuler un départ (Arrivals & departures -> Cancel) annulait seulement ses tâches : la
demande restait "Approved" (le collaborateur ne pouvait plus en refaire une, l'historique ne disait rien).
On répare les départs déjà annulés : leur demande devient "Cancelled", avec le même motif et la même personne.
(Sans cloche : c'est une réparation des données, pas une nouvelle action.)"""
from django.db import migrations


def fix(apps, schema_editor):
    Departure = apps.get_model("journeys", "Departure")
    for departure in Departure.objects.filter(journey__cancelled_at__isnull=False, request__status="APPROVED").select_related(
            "journey", "request"):
        request, journey = departure.request, departure.journey
        request.status, request.closed_at = "CANCELLED", journey.cancelled_at
        request.cancelled_by_id, request.cancel_reason = journey.cancelled_by_id, journey.cancel_reason
        request.save(update_fields=["status", "closed_at", "cancelled_by", "cancel_reason"])


class Migration(migrations.Migration):
    dependencies = [("journeys", "0004_auto_block"), ("workflows", "0014_departure_manager_first")]
    operations = [migrations.RunPython(fix, migrations.RunPython.noop)]
