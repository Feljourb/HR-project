"""La cloche des arrivées et départs (le texte, le rappel des tâches en retard), la validation d'un départ,
et le tour du matin ("Sorti" le lendemain du dernier jour)."""
from django.utils import timezone

from employees.models import Notification
from employees.notifications import on_bell_refresh, on_morning_round
from workflows.engine import on_approved

from .models import Departure, Kind
from .services import close_departures, journey_of, open_departure, tasks_of


@on_approved("DEPARTURE")
def departure_approved(request):
    """Les RH ont validé le départ (Team approvals) : les tâches du départ commencent."""
    departure = Departure.objects.filter(request=request).select_related("employee").first()
    if departure is None:
        return  # une demande saisie par les RH : request_departure ouvre le départ lui-même, juste après
    step = request.steps.filter(status="APPROVED").select_related("decided_by").order_by("-decided_at").first()
    open_departure(departure, step.decided_by if step else None)


@on_morning_round
def close_finished_departures():
    """Chaque matin : le dernier jour est passé -> "Sorti", compte bloqué (sans que les RH y pensent)."""
    close_departures()


def journey_message(notification, name):
    """Ex. "Arrivée de Sara Alami le 01/12/2026 : vous avez 2 tâche(s) à faire (la première avant le 28/11/2026 :
    Préparer le PC et l'email)." Calculé à l'affichage : le nombre baisse quand on coche "Fait"."""
    journey = journey_of(notification)
    arrival = journey is None or journey.kind == Kind.ARRIVAL
    label = f"{'Arrivée' if arrival else 'Départ'} de {name} le {notification.due_date:%d/%m/%Y}"
    if notification.kind == Notification.Kind.ACCOUNT_BLOCKED:
        return (f"{name} est maintenant « Sorti » (dernier jour le {notification.due_date:%d/%m/%Y}) : "
                f"son compte est bloqué automatiquement.")
    if notification.kind == Notification.Kind.ACCOUNT_TO_BLOCK:
        if notification.employee.status == notification.employee.Status.LEFT:
            return f"{name} est « Sorti » : son compte est bloqué."
        return (f"Le dernier jour de {name} était le {notification.due_date:%d/%m/%Y} : mettez sa fiche en « Sorti » "
                f"pour bloquer son compte.")
    if notification.kind == Notification.Kind.JOURNEY_DONE:
        return f"{label} : toutes les tâches sont faites."
    if notification.kind == Notification.Kind.JOURNEY_CANCELLED:
        # Ex. "L'arrivée de Test Arivee (14/12/2026) est annulée : vous n'avez plus rien à faire. Motif : ..."
        what = "L'arrivée" if arrival else "Le départ"
        reason = f" Motif : {journey.cancel_reason}" if journey and journey.cancel_reason else ""
        return (f"{what} de {name} ({notification.due_date:%d/%m/%Y}) est {'annulée' if arrival else 'annulé'} : "
                f"vous n'avez plus rien à faire.{reason}")
    if journey is None:
        return f"{label}."
    if journey.cancelled_at:
        return f"{label} : annulé. Motif : {journey.cancel_reason}"
    waiting = tasks_of(notification.recipient).filter(journey=journey, done_at__isnull=True).order_by("due_date", "id")
    if notification.kind == Notification.Kind.TASK_LATE:
        late = list(waiting.filter(due_date__lt=timezone.localdate()))
        if not late:
            return f"{label} : plus aucune tâche en retard."
        what = "l'arrivée" if arrival else "le départ"
        return f"En retard : {len(late)} tâche(s) pour {what} de {name} (prévue le {late[0].due_date:%d/%m/%Y} : {late[0].name})."
    count = waiting.count()
    if count == 0:
        return f"{label} : toutes vos tâches sont faites."
    first = waiting.first()
    return f"{label} : vous avez {count} tâche(s) à faire (la première avant le {first.due_date:%d/%m/%Y} : {first.name})."


@on_bell_refresh
def remind_late(user):
    """Une tâche pas faite après sa date : 🔔 "En retard" (une par parcours ; enlevée, si pas lue, quand c'est rattrapé).
    Comme les autres rappels : calculé à l'ouverture de la cloche et au tour du matin (email)."""
    late = tasks_of(user).filter(done_at__isnull=True, due_date__lt=timezone.localdate())
    pairs = {(task.journey.employee_id, task.journey.day) for task in late}
    Notification.objects.bulk_create(
        [Notification(recipient=user, employee_id=employee, kind=Notification.Kind.TASK_LATE, due_date=day) for employee, day in pairs],
        ignore_conflicts=True,
    )
    for notification in Notification.objects.filter(recipient=user, kind=Notification.Kind.TASK_LATE, read_at__isnull=True):
        if (notification.employee_id, notification.due_date) not in pairs:
            notification.delete()
