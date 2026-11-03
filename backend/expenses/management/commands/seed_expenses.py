"""Des notes de frais de démonstration, pour la présentation des pages "Expense claims", "Team approvals"
et "Reimbursements".

    make seed-expenses   (après make seed, qui crée les dossiers des comptes de test)

- Seulement en développement (DEBUG=True).
- Les dates partent d'AUJOURD'HUI (les jours d'avant) ; chaque dépense a un justificatif PDF de démonstration.
- Passe par submit_claim(), le moteur et mark_reimbursed(), exactement comme les pages : les règles s'appliquent
  (plafonds du grade...). Une règle refusée est affichée, pas cachée.
- Un compte de test sans grade (fiche créée avant que le grade soit obligatoire) reçoit le "Grade E — Employé".
- On peut le relancer : une note de démo déjà envoyée (même collaborateur, même objet) est ignorée.
"""
import datetime
from io import BytesIO

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from reportlab.lib.pagesizes import A6
from reportlab.pdfgen import canvas

from employees.models import Employee, Grade
from workflows import engine
from workflows.models import Request

from ...models import ExpenseCategory, ExpenseClaim
from ...services import mark_reimbursed, submit_claim

# (username, objet, [(il y a N jours, catégorie, montant, détail)], ce qui se passe ensuite).
# "approve" : le N+1 valide ; "reimburse" : validée puis remboursée par un RH ; None : reste "en cours".
DEMOS = [
    ("collab.test", "Mission Agadir (démo)", [
        (6, "Transport (taxi, tram, train, bus)", "300", "Train Casablanca -> Marrakech, puis car"),
        (6, "Hébergement (hôtel)", "380", "Hôtel, 1 nuit"),
        (6, "Indemnité journalière (repas et frais du jour)", "180", "Repas du jour"),
        (5, "Indemnité journalière (repas et frais du jour)", "160", "Repas du jour"),
    ], "approve"),
    ("collab.test", "Visite client Rabat (démo)", [
        (2, "Transport (taxi, tram, train, bus)", "120", "Taxi gare -> client"),
        (2, "Péage et parking", "40", "Parking"),
    ], None),
    ("collab.test", "Fournitures bureau (démo)", [
        (20, "Fournitures et petit matériel", "95", "Cahiers et stylos"),
    ], "reimburse"),
    ("manager.test", "Salon professionnel (démo)", [
        (3, "Hébergement (hôtel)", "350", "Hôtel, 1 nuit"),
        (3, "Transport (taxi, tram, train, bus)", "200", "Train"),
    ], None),
]


def demo_receipt(text):
    """Un petit PDF "ticket de démonstration" (un vrai fichier, pour essayer l'ouverture des justificatifs)."""
    buffer = BytesIO()
    page = canvas.Canvas(buffer, pagesize=A6)
    page.setFont("Helvetica-Bold", 12)
    page.drawString(30, 330, "TICKET DE DÉMONSTRATION")
    page.setFont("Helvetica", 10)
    for row, line in enumerate(text.split("\n")):
        page.drawString(30, 300 - row * 16, line)
    page.save()
    return SimpleUploadedFile("ticket-demo.pdf", buffer.getvalue(), content_type="application/pdf")


def validate_by_n_plus_1(request):
    """Le N+1 (la personne trouvée à l'envoi) valide l'étape qui attend ; sinon un RH du pôle."""
    request.refresh_from_db()
    step = request.steps.filter(status="PENDING").first()
    if step is None:
        return
    user = step.assignee.user if step.assignee_id else engine.hr_validators(request.requester).first()
    if user is not None:
        engine.approve(step, user, "Validé (démo)")


class Command(BaseCommand):
    help = "Envoie des notes de frais de démonstration (développement seulement)."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Réservé au développement (DEBUG=True).")

        today = timezone.localdate()
        default_grade = Grade.objects.filter(name="Grade E — Employé").first()
        for username, title, lines, then in DEMOS:
            employee = Employee.objects.filter(user__username=username).first()
            if employee is None:
                raise CommandError(f"{username} n'a pas de dossier RH : lancez d'abord make seed.")
            if employee.grade_id is None and default_grade is not None:
                Employee.objects.filter(pk=employee.pk).update(grade=default_grade)
                employee.refresh_from_db()
                self.stdout.write(f"- {username} : pas de grade, il reçoit « {default_grade} »")
            if ExpenseClaim.objects.filter(employee=employee, title=title).exists():
                self.stdout.write(f"- {username} : « {title} » déjà envoyée, ignorée")
                continue
            data = [{
                "date": today - datetime.timedelta(days=days_ago),
                "category": ExpenseCategory.objects.get(name=category),
                "amount": amount, "description": detail,
                "receipt": demo_receipt(f"{detail}\nMontant : {amount} MAD\nDate : {today - datetime.timedelta(days=days_ago):%d/%m/%Y}"),
            } for days_ago, category, amount, detail in lines]
            try:
                claim = submit_claim(employee, title, data)
                if then in ("approve", "reimburse"):
                    validate_by_n_plus_1(claim.request)
                claim.request.refresh_from_db()
                if then == "reimburse" and claim.request.status == Request.Status.APPROVED:
                    hr = engine.hr_validators(employee).first()
                    if hr is not None:
                        mark_reimbursed(claim, hr)
            except ValidationError as error:
                self.stdout.write(self.style.WARNING(f"! {username} : « {title} » refusée : {error.messages[0]}"))
                continue
            claim.refresh_from_db()
            label = "Remboursée" if claim.reimbursed_at else claim.request.get_status_display()
            self.stdout.write(self.style.SUCCESS(f"+ {username} : {claim.request.title} -> {label}"))
