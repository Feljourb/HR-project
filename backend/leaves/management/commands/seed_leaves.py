"""Des congés de démonstration, pour la présentation des pages "Leave requests", "Team approvals" et "Absences".

    make seed-leaves   (après make seed, qui crée les dossiers des comptes de test)

- Seulement en développement (DEBUG=True).
- Les dates partent d'AUJOURD'HUI (le lundi qui vient) : la démo est toujours dans le futur proche.
- Passe par request_leave() et le moteur, exactement comme le formulaire et les valideurs :
  les règles s'appliquent (solde, chevauchement, 6 mois de service...). Une règle refusée est affichée, pas cachée.
- On peut le relancer : un congé de démo déjà envoyé (même collaborateur, même motif) est ignoré.
"""
import datetime

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from employees.models import Employee
from workflows import engine
from workflows.models import Request

from ...models import LeaveRequest, LeaveType
from ...services import request_leave

# (username, type, début = lundi qui vient + N jours, durée en jours, motif, ce que fait le valideur).
# "approve" : le circuit va jusqu'au bout (acceptée) ; "reject" : refusée ; None : reste "en cours".
DEMOS = [
    ("collab.test", "Congé annuel", 0, 4, "Vacances en famille (démo)", "approve"),
    ("collab.test", "Congé annuel", 21, 2, "Pont de fin d'année (démo)", None),
    # Un rendez-vous médical planifié (dans le futur) : depuis P1 step 4, une maladie ne commence pas plus de
    # 2 jours dans le passé (au-delà, ce sont les RH qui l'enregistrent).
    ("collab.test", "Congé maladie", 10, 1, "Rendez-vous médical (démo)", "approve"),
    ("collab.test", "Congé annuel", 35, 4, "Voyage (démo)", "reject"),
    ("manager.test", "Congé annuel", 7, 4, "Congé du manager (démo)", None),
    # hr.test n'a pas de N+1 : c'est une AUTRE RH du pôle (ou une Admin RH) qui valide, dans "Team approvals".
    ("hr.test", "Congé exceptionnel - Naissance", 2, 2, "Naissance (démo)", None),
]


def next_monday(day):
    return day + datetime.timedelta(days=(7 - day.weekday()) % 7 or 7)


def answer(request, decision):
    """Répond à chaque étape qui attend, comme le ferait le valideur (N+1, puis RH...)."""
    while True:
        request.refresh_from_db()
        step = request.steps.filter(status="PENDING").first()
        if request.status != Request.Status.IN_PROGRESS or step is None:
            return
        # Qui répond : la personne trouvée à l'envoi (N+1, DG), sinon un RH du pôle (ou une Admin RH).
        user = step.assignee.user if step.assignee_id else engine.hr_validators(request.requester).first()
        if user is None:
            return
        if decision == "reject":
            engine.reject(step, user, "Période chargée, merci de choisir d'autres dates (démo).")
            return
        engine.approve(step, user, "Bon congé ! (démo)")


class Command(BaseCommand):
    help = "Envoie des congés de démonstration (développement seulement)."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Réservé au développement (DEBUG=True).")

        monday = next_monday(timezone.localdate())
        for username, type_name, offset, length, reason, decision in DEMOS:
            employee = Employee.objects.filter(user__username=username).first()
            if employee is None:
                raise CommandError(f"{username} n'a pas de dossier RH : lancez d'abord make seed.")
            if LeaveRequest.objects.filter(employee=employee, reason=reason).exists():
                self.stdout.write(f"- {username} : « {reason} » déjà envoyé, ignoré")
                continue
            start = monday + datetime.timedelta(days=offset)
            end = start + datetime.timedelta(days=length - 1)
            try:
                leave = request_leave(employee, LeaveType.objects.get(name=type_name), start, end, reason=reason)
                if decision:  # None : personne ne répond, le congé reste "en cours"
                    answer(leave.request, decision)
            except ValidationError as error:
                self.stdout.write(self.style.WARNING(f"! {username} : « {reason} » refusé : {error.messages[0]}"))
                continue
            leave.request.refresh_from_db()
            self.stdout.write(self.style.SUCCESS(
                f"+ {username} : {leave.request.title} -> {leave.request.get_status_display()}"))
