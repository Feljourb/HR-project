"""Envoie des demandes de démonstration, pour essayer "My requests" et "Team approvals"
avant que les modules (Congé, Note de frais...) aient leur formulaire.

    make seed-requests   (après make seed, qui crée les dossiers des comptes de test)

- Seulement en développement (DEBUG=True).
- Passe par engine.submit(), exactement comme le fera le formulaire d'un module.
- On peut le relancer sans risque : une demande de démo déjà envoyée (même titre, même demandeur) est ignorée.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from employees.models import Employee
from workflows import engine
from workflows.models import Request

# (username du demandeur, code du circuit, titre). Ce qu'on verra dans les pages :
# - collab.test : ses 3 demandes dans "My requests" ;
# - manager.test : les 2 premières dans "Team approvals" (il est le N+1 de collab.test) ;
# - hr.test : l'attestation de collab.test, et le congé de manager.test (sans N+1 : la RH valide).
DEMOS = [
    ("collab.test", "LEAVE", "Congé du 10 au 14 novembre (démo)"),
    ("collab.test", "EXPENSE", "Note de frais : déplacement à Agadir (démo)"),
    ("collab.test", "ADMIN_REQUEST", "Attestation de travail (démo)"),
    ("manager.test", "LEAVE", "Congé du 1er au 5 décembre (démo)"),
]


class Command(BaseCommand):
    help = "Envoie des demandes de démonstration dans les circuits (développement seulement)."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Réservé au développement (DEBUG=True).")

        for username, code, title in DEMOS:
            requester = Employee.objects.filter(user__username=username).first()
            if requester is None:
                raise CommandError(f"{username} n'a pas de dossier RH : lancez d'abord make seed.")
            if Request.objects.filter(requester=requester, title=title).exists():
                self.stdout.write(f"- {title} : déjà envoyée, ignorée")
                continue
            request = engine.submit(code, requester, title)
            waiting = request.steps.filter(status="PENDING").first()
            who = waiting.get_approver_display() if waiting else "personne"
            self.stdout.write(self.style.SUCCESS(f"+ {title} ({username}) -> attend : {who}"))
