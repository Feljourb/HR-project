"""Envoie UNE demande dans son circuit, depuis le terminal (pour tester, ou montrer le moteur en direct).

    make send-request user=collab.test type=LEAVE title="Congé du 2 au 6 décembre"

    user  : le compte du demandeur (il doit avoir un dossier RH)
    type  : LEAVE (Congé), EXPENSE (Note de frais) ou ADMIN_REQUEST (Demande administrative)
    title : le texte affiché dans les pages et dans la cloche

Elle fait EXACTEMENT ce que fera le formulaire d'un module : engine.submit(). Donc le moteur
copie le circuit, trouve qui valide, et la cloche 🔔 de ce valideur s'allume.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from employees.models import Employee
from workflows import engine
from workflows.models import Workflow


class Command(BaseCommand):
    help = "Envoie une demande dans son circuit (développement seulement)."

    def add_arguments(self, parser):
        # Les 3 informations à donner après le nom de la commande.
        parser.add_argument("username", help="le compte du demandeur, ex. collab.test")
        parser.add_argument("code", choices=Workflow.Code.values, help="LEAVE, EXPENSE ou ADMIN_REQUEST")
        parser.add_argument("title", help='ex. "Congé du 2 au 6 décembre"')

    def handle(self, username, code, title, **options):
        if not settings.DEBUG:
            raise CommandError("Réservé au développement (DEBUG=True).")
        requester = Employee.objects.filter(user__username=username).select_related("user").first()
        if requester is None:
            raise CommandError(f"{username} n'a pas de dossier RH.")
        try:
            request = engine.submit(code, requester, title)
        except ValidationError as error:  # ex. "Ce type de demande est désactivé."
            raise CommandError(error.messages[0])

        # Ce que le moteur a fait, étape par étape (comme la page d'historique).
        self.stdout.write(self.style.SUCCESS(f"Demande n°{request.id} envoyée : {title} ({request.workflow.name})"))
        for step in request.steps.all():
            who = str(step.assignee) if step.assignee else "RH du pôle + Admin RH"
            self.stdout.write(f"  {step.order}. {step.get_approver_display():12} {step.get_mode_display():9} -> {who:35} {step.get_status_display()}")
        waiting = request.steps.filter(status="PENDING").first()
        if waiting:
            names = ", ".join(user.username for user in engine.people_of(waiting))
            self.stdout.write(self.style.WARNING(f"🔔 Notification envoyée à : {names}"))
