"""
Les notifications de la cloche 🔔 pour les demandes (step 7).

Le moteur (engine.py) les envoie au moment où ça se passe :
- une étape "Valider" attend quelqu'un      -> "Demande à valider" (le N+1, ou tous les RH du pôle...) ;
- une étape "Informer" est atteinte          -> "Pour information" ;
- la demande est acceptée / refusée          -> le demandeur est prévenu ;
- quelqu'un a répondu, ou la demande est annulée -> les "Demande à valider" pas encore lues partent
  (elles n'attendent plus personne). Celles déjà lues restent : c'est l'historique de la personne.

Les notifications vivent dans la table de la cloche (employees.Notification), à côté de la fin de période d'essai.
"""
from datetime import timedelta

from django.utils import timezone

from employees.models import Notification
from employees.notifications import on_bell_refresh

Kind = Notification.Kind
REMIND_AFTER_DAYS = 3  # le même seuil que la pastille ambre du tableau de bord


def send(users, kind, request):
    """Une notification de ce type, pour chacun de ces comptes."""
    Notification.objects.bulk_create(
        Notification(recipient=user, employee=request.requester, kind=kind, request=request) for user in users
    )


def clear_waiting(request):
    """La demande n'attend plus ces personnes : leurs "Demande à valider", rappels et "Pas encore validée"
    pas encore lus sont retirés."""
    Notification.objects.filter(request=request, kind__in=[Kind.TO_VALIDATE, Kind.REMINDER, Kind.NOT_VALIDATED],
                                read_at__isnull=True).delete()


@on_bell_refresh
def sync_stand_in(user):
    """Délégations (2026-11-12) : la cloche du délégué suit la période, comme sa page. Fait à l'ouverture de la cloche
    et au tour du matin (donc l'email part aussi), et à "End now".
    - Fin (date passée ou "End now") : ses "Demande à valider" et rappels PAS ENCORE LUS d'une demande qui n'attend
      plus sa réponse partent (le lu reste : c'est son historique).
    - Début (ex. prévue le 13, on est le 13) : 🔔 "Demande à valider" pour chaque demande qui attendait DÉJÀ l'absent
      (standard : le délégué couvre tout ce qui attend pendant la période), une seule fois par demande."""
    from .engine import steps_waiting_for  # ici : engine importe déjà ce fichier
    from .models import Delegation

    waiting = list(steps_waiting_for(user).select_related("request__requester", "assignee"))
    waiting_requests = {step.request_id for step in waiting}
    Notification.objects.filter(recipient=user, kind__in=[Kind.TO_VALIDATE, Kind.REMINDER], read_at__isnull=True,
                                request__isnull=False).exclude(request__in=waiting_requests).delete()

    today = timezone.localdate()
    if not Delegation.objects.filter(delegate__user=user, ended_at__isnull=True,
                                     start_date__lte=today, end_date__gte=today).exists():
        return
    told = set(Notification.objects.filter(recipient=user, kind=Kind.TO_VALIDATE, request__in=waiting_requests)
               .values_list("request", flat=True))
    Notification.objects.bulk_create(
        Notification(recipient=user, employee=step.request.requester, kind=Kind.TO_VALIDATE, request=step.request)
        for step in waiting
        # Seulement les étapes de l'absent (les miennes ont déjà eu leur notification à l'envoi).
        if step.assignee_id and step.assignee.user_id != user.pk and step.request_id not in told
    )


@on_bell_refresh
def remind_waiting_requests(user):
    """P3 (rappel, standard) : une demande attend MA réponse depuis 3 jours ou plus -> 🔔 "Rappel : Sara attend votre
    réponse depuis 4 jours". Un seul rappel par demande et par étape (due_date = le jour où elle a eu 3 jours).
    Pour tous ceux qui peuvent répondre : le valideur, son délégué, son responsable ou les RH s'il est absent."""
    from .engine import steps_waiting_for  # ici : engine importe déjà ce fichier

    today = timezone.localdate()
    reminders = []
    for step in steps_waiting_for(user).select_related("request__requester").prefetch_related("request__steps"):
        # Depuis quand l'étape attend : la réponse de l'étape d'avant, sinon l'envoi de la demande.
        before = [other.decided_at for other in step.request.steps.all() if other.order < step.order and other.decided_at]
        since = timezone.localtime(max(before) if before else step.request.created_at).date()
        due = since + timedelta(days=REMIND_AFTER_DAYS)
        if today >= due:
            reminders.append(Notification(recipient=user, employee=step.request.requester, kind=Kind.REMINDER,
                                          request=step.request, due_date=due))
    Notification.objects.bulk_create(reminders, ignore_conflicts=True)
