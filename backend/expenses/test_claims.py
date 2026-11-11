"""Tests des notes de frais : les règles, l'envoi dans le circuit, le PDF, les justificatifs, le remboursement, l'API."""
import datetime
import json
import shutil
import tempfile
from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Department, Employee, Grade
from workflows import engine
from workflows.models import Request, RequestStep, WorkflowStep
from workflows.test_engine import EngineTestCase

from .models import ExpenseCategory, ExpenseClaim
from .services import mark_reimbursed, submit_claim

User = get_user_model()
MEDIA = tempfile.mkdtemp()  # les justificatifs des tests vont ici (effacé à la fin), pas dans media/


def ticket(name="ticket.jpg", size=1000):
    return SimpleUploadedFile(name, b"x" * size, content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA)
class ClaimTestCase(EngineTestCase):
    """Sara (Ventes, Grade E par défaut) ; son N+1 est Youssef ; Nadia et Hind sont RH de SBD."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.hotel = ExpenseCategory.objects.get(name="Hébergement (hôtel)")      # Grade E : 400 par nuit
        self.taxi = ExpenseCategory.objects.get(name="Transport (taxi, tram, train, bus)")  # Grade E : 350
        self.fuel = ExpenseCategory.objects.get(name="Carburant")                # pas de plafond
        self.yesterday = timezone.localdate() - datetime.timedelta(days=1)

    def line(self, category=None, amount="100", receipts="default", **fields):
        return {"date": self.yesterday, "category": category or self.taxi, "amount": Decimal(amount),
                "description": "", "receipts": [ticket()] if receipts == "default" else receipts, **fields}

    def errors_of(self, lines, title="Mission Agadir", employee=None):
        with self.assertRaises(ValidationError) as error:
            submit_claim(employee or self.sara, title, lines)
        return error.exception.message_dict


@override_settings(DEBUG=True, MEDIA_ROOT=MEDIA)
class DemoCommandTests(TestCase):
    def test_make_seed_expenses(self):
        call_command("seed_test_fiches", stdout=StringIO())  # make seed : les comptes de test et leurs dossiers
        out = StringIO()
        call_command("seed_expenses", stdout=out)
        claims = ExpenseClaim.objects.select_related("request")
        self.assertEqual(claims.count(), 4, out.getvalue())
        self.assertEqual(sorted(c.request.status for c in claims), ["APPROVED", "APPROVED", "IN_PROGRESS", "IN_PROGRESS"])
        self.assertEqual(claims.filter(reimbursed_at__isnull=False).count(), 1)
        call_command("seed_expenses", stdout=StringIO())  # relancée : rien de nouveau
        self.assertEqual(ExpenseClaim.objects.count(), 4)


class RulesTests(ClaimTestCase):
    def test_a_claim_goes_into_the_circuit_with_its_total(self):
        claim = submit_claim(self.sara, "Mission Agadir", [self.line(amount="120"), self.line(self.hotel, "380.50")])
        self.assertEqual(claim.total, Decimal("500.50"))
        self.assertEqual(claim.request.title, "Note de frais : Mission Agadir (500,50 MAD)")
        # Circuit (décision du 2026-11-03) : N+1 valide, puis RH informée.
        self.assertEqual([(s.approver, s.mode, s.status) for s in claim.request.steps.all()], [
            (WorkflowStep.Approver.MANAGER, WorkflowStep.Mode.VALIDATE, RequestStep.Status.PENDING),
            (WorkflowStep.Approver.HR, WorkflowStep.Mode.INFORM, RequestStep.Status.WAITING),
        ])
        self.assertEqual(claim.request.steps.first().assignee, self.youssef)
        self.assertTrue(claim.lines.first().receipts.get().file.name.startswith("receipts/"))

    def test_several_receipts_for_one_expense(self):
        # L'hôtel : la facture + le ticket de la carte bancaire, sur la MÊME dépense.
        claim = submit_claim(self.sara, "Mission", [self.line(self.hotel, "380", receipts=[ticket("facture.pdf"), ticket("carte.jpg")])])
        self.assertEqual([r.name for r in claim.lines.get().receipts.all()], ["facture.pdf", "carte.jpg"])
        # Au plus 5 ; un mauvais fichier parmi d'autres : son nom dans le message.
        self.assertIn("Au plus 5", self.errors_of([self.line(receipts=[ticket() for _ in range(6)])])["line_0"][0])
        self.assertIn("virus.exe", self.errors_of([self.line(receipts=[ticket(), ticket("virus.exe")])])["line_0"][0])

    def test_the_ceiling_of_the_grade(self):
        # Grade E : hôtel 400 MAD par nuit.
        errors = self.errors_of([self.line(), self.line(self.hotel, "450")])
        self.assertIn("Plafond hôtel (par nuit) pour votre grade : 400.00 MAD", errors["line_1"][0])
        self.assertNotIn("line_0", errors)  # la première ligne est bonne
        # Un Grade A : 1200 par nuit -> permis.
        Employee.objects.filter(pk=self.sara.pk).update(grade=Grade.objects.get(name="Grade A — Direction"))
        sara = Employee.objects.get(pk=self.sara.pk)
        submit_claim(sara, "Mission Agadir", [self.line(self.hotel, "450")])
        # Le carburant n'a pas de plafond.
        submit_claim(sara, "Plein", [self.line(self.fuel, "5000")])

    def test_no_grade_no_ceiling_category(self):
        Employee.objects.filter(pk=self.sara.pk).update(grade=None)  # une ancienne fiche
        sara = Employee.objects.get(pk=self.sara.pk)
        self.assertIn("pas de grade", self.errors_of([self.line(self.hotel, "100")], employee=sara)["line_0"][0])
        submit_claim(sara, "Plein", [self.line(self.fuel, "100")])  # sans plafond : permis

    def test_line_rules(self):
        tomorrow = timezone.localdate() + datetime.timedelta(days=1)
        self.assertIn("futur", self.errors_of([self.line(date=tomorrow)])["line_0"][0])
        self.assertIn("Justificatif obligatoire", self.errors_of([self.line(receipts=[])])["line_0"][0])
        self.assertIn("5 Mo", self.errors_of([self.line(receipts=[ticket(size=6 * 1024 * 1024)])])["line_0"][0])
        self.assertIn("line_0", self.errors_of([self.line(receipts=[ticket("virus.exe")])]))
        self.assertIn("line_0", self.errors_of([self.line(amount="0")]))
        # Même sans plafond (carburant) : au plus 100 000 MAD par dépense (une faute de frappe).
        self.assertIn("trop élevé", self.errors_of([self.line(self.fuel, "100000.01")])["line_0"][0])
        ExpenseCategory.objects.filter(pk=self.taxi.pk).update(is_active=False)
        self.taxi.refresh_from_db()
        self.assertIn("plus proposée", self.errors_of([self.line()])["line_0"][0])

    def test_claim_rules_and_nothing_saved(self):
        self.assertIn("title", self.errors_of([self.line()], title="  "))
        self.assertIn("lines", self.errors_of([]))
        self.assertFalse(ExpenseClaim.objects.exists())
        self.assertFalse(Request.objects.exists())  # pas de demande dans le circuit non plus

    def test_reimbursement_by_hr_of_the_pole(self):
        claim = submit_claim(self.sara, "Mission", [self.line()])
        with self.assertRaises(ValidationError):
            mark_reimbursed(claim, self.nadia.user)  # pas encore validée
        engine.approve(claim.request.steps.get(status="PENDING"), self.youssef.user)
        with self.assertRaises(PermissionDenied):
            mark_reimbursed(claim, self.youssef.user)  # le N+1 n'est pas RH
        claim = mark_reimbursed(claim, self.nadia.user)
        self.assertEqual((claim.reimbursed_at, claim.reimbursed_by), (timezone.localdate(), self.nadia.user))
        with self.assertRaises(ValidationError):
            mark_reimbursed(claim, self.hind.user)  # déjà remboursée


class ApiTests(ClaimTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.login(self.sara)

    def login(self, employee, role=None):
        if role:
            employee.user.role = role
        employee.user.must_change_password = False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def send(self, lines, files=None, title="Mission Agadir"):
        """Comme le formulaire : multipart, les lignes en JSON, les fichiers receipt_0, receipt_1..."""
        data = {"title": title, "lines": json.dumps(lines)}
        data.update(files if files is not None else {f"receipt_{i}": ticket() for i in range(len(lines))})
        return self.client.post(reverse("expenses:mine-list"), data, format="multipart")

    def raw(self, category=None, amount="100"):
        return {"date": self.yesterday.isoformat(), "category": (category or self.taxi).pk, "amount": amount, "description": "Taxi"}

    def test_send_and_see_my_claims(self):
        # Comme le formulaire : deux fichiers sous le MÊME nom receipt_1 (la facture + le ticket de carte de l'hôtel).
        response = self.send([self.raw(), self.raw(self.hotel, "300")],
                             files={"receipt_0": ticket(), "receipt_1": [ticket("facture.pdf"), ticket("carte.jpg")]})
        self.assertEqual(response.status_code, 201, response.json())
        data = response.json()
        self.assertEqual([r["name"] for r in data["lines"][1]["receipts"]], ["facture.pdf", "carte.jpg"])
        self.assertEqual((data["total"], data["status"], data["grade"]), (400, "IN_PROGRESS", "Grade E — Employé"))
        self.assertIn("(N+1)", data["waiting_for"])
        self.assertEqual(len(self.client.get(reverse("expenses:mine-list")).json()), 1)
        # Mon barème, pour les aides du formulaire.
        self.assertEqual(self.client.get(reverse("expenses:mine-scale")).json()["scale"]["hotel"], 400)

    def test_my_scale_without_grade_is_still_json(self):
        # Une ancienne fiche sans grade : un objet JSON (pas une réponse vide qui bloque la page).
        Employee.objects.filter(pk=self.sara.pk).update(grade=None)
        self.assertEqual(self.client.get(reverse("expenses:mine-scale")).json(), {"grade": None, "scale": None})

    def test_errors_are_given_line_by_line(self):
        response = self.send([self.raw(), self.raw(self.hotel, "900")])
        self.assertEqual(response.status_code, 400)
        self.assertIn("line_1", response.json())
        self.assertNotIn("line_0", response.json())
        # Un montant énorme : refusé avec un message clair, sous sa ligne.
        huge = self.send([self.raw(self.fuel, "1000000000000000")])
        self.assertEqual(huge.status_code, 400)
        self.assertIn("trop élevé", huge.json()["line_0"][0])
        missing = self.send([{"category": self.taxi.pk, "amount": "10"}], files={})
        self.assertIn("date", missing.json()["line_0"][0])

    def test_pdf_after_the_validation_and_receipts_for_the_people_concerned(self):
        request_id = self.send([self.raw()]).json()["request"]
        pdf = reverse("expenses:claim-pdf", args=[request_id])
        self.assertEqual(self.client.get(pdf).status_code, 400)  # pas encore validée
        claim = ExpenseClaim.objects.get(request=request_id)
        engine.approve(claim.request.steps.get(status="PENDING"), self.youssef.user)
        response = self.client.get(pdf)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"%PDF"))
        # Le justificatif : moi oui, mon N+1 oui, un collègue d'un autre service non (404).
        receipt = reverse("expenses:receipt-detail", args=[claim.lines.get().receipts.get().pk])
        self.assertEqual(self.client.get(receipt).status_code, 200)
        self.login(self.youssef)
        self.assertEqual(self.client.get(receipt).status_code, 200)
        other = self.make_alone("ali.autre", "AA100020")
        self.login(other)
        self.assertEqual(self.client.get(receipt).status_code, 404)
        self.assertEqual(self.client.get(reverse("expenses:claim-detail", args=[request_id])).status_code, 404)

    def test_hr_lists_and_reimburses(self):
        request_id = self.send([self.raw()]).json()["request"]
        claim = ExpenseClaim.objects.get(request=request_id)
        engine.approve(claim.request.steps.get(status="PENDING"), self.youssef.user)
        self.login(self.nadia, User.Role.HR)
        hr = reverse("expenses:hr-list")
        self.assertEqual([c["request"] for c in self.client.get(hr, {"status": "to_reimburse"}).json()], [request_id])
        response = self.client.post(reverse("expenses:hr-reimburse", args=[request_id]))
        self.assertEqual(response.status_code, 200, response.json())
        self.assertIsNotNone(response.json()["reimbursed_at"])
        self.assertEqual(self.client.get(hr, {"status": "to_reimburse"}).json(), [])
        self.assertEqual(len(self.client.get(hr, {"status": "reimbursed"}).json()), 1)
        # Une RH de Riaya ne voit pas les notes de SBD.
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        riaya_hr = self.make_hr("rh.riaya", "AA100021", department=production, position=production.positions.first())
        self.login(riaya_hr)
        self.assertEqual(self.client.get(hr, {"status": "all"}).json(), [])
        # Un collaborateur : non.
        self.login(self.sara)
        self.assertEqual(self.client.get(hr).status_code, 403)

    def test_admin_rh_manages_the_categories_on_the_lists_page(self):
        url = reverse("expenses:list-categories-list")
        self.assertEqual(self.client.post(url, {"name": "Visa", "ceiling": "NONE"}, format="json").status_code, 403)
        self.login(self.nadia, User.Role.HR_ADMIN)
        response = self.client.post(url, {"name": "Visa", "ceiling": "TRANSPORT", "receipt_required": False}, format="json")
        self.assertEqual((response.status_code, response.json()["ceiling"]), (201, "TRANSPORT"))
        self.assertIn("Visa", [c["name"] for c in self.client.get(reverse("expenses:category-list")).json()])

    def test_only_admin_rh_changes_the_scale(self):
        scale = self.client.get(reverse("expenses:scale-list")).json()[0]
        url = reverse("expenses:scale-detail", args=[scale["id"]])
        self.assertEqual(self.client.patch(url, {"hotel": "999"}, format="json").status_code, 403)
        self.login(self.nadia, User.Role.HR_ADMIN)
        self.assertEqual(self.client.patch(url, {"hotel": "999"}, format="json").json()["hotel"], 999)
