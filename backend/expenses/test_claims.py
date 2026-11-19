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

from employees import notifications
from employees.models import Department, Employee, Grade, Notification
from workflows import engine
from workflows.models import Request, RequestStep, WorkflowStep
from workflows.test_engine import EngineTestCase

from .models import CategoryCeiling, Currency, ExpenseCategory, ExpenseClaim, ExpenseSettings
from .pdf import claim_pdf
from .rates import update_rates
from .serializers import ClaimSerializer
from .services import correct_line, correction_role, mark_reimbursed, submit_claim

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

    def approve_all(self, claim):
        """Le circuit complet (2026-11-16) : le N+1 (Youssef) valide, puis le contrôle RH (Nadia) valide."""
        engine.approve(claim.request.steps.get(status="PENDING"), self.youssef.user)
        engine.approve(claim.request.steps.get(status="PENDING"), self.nadia.user)

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
        # Circuit (2026-11-16, remarque de la réunion) : N+1 valide, puis les RH VALIDENT (le contrôle).
        self.assertEqual([(s.approver, s.mode, s.status) for s in claim.request.steps.all()], [
            (WorkflowStep.Approver.MANAGER, WorkflowStep.Mode.VALIDATE, RequestStep.Status.PENDING),
            (WorkflowStep.Approver.HR, WorkflowStep.Mode.VALIDATE, RequestStep.Status.WAITING),
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
        self.assertIn("(par nuit) pour votre grade : 400.00 MAD", errors["line_1"][0])
        self.assertNotIn("line_0", errors)  # la première ligne est bonne
        # Un Grade A : 1200 par nuit -> permis.
        Employee.objects.filter(pk=self.sara.pk).update(grade=Grade.objects.get(name="Grade A — Direction"))
        sara = Employee.objects.get(pk=self.sara.pk)
        submit_claim(sara, "Mission Agadir", [self.line(self.hotel, "450")])
        # Le carburant n'a pas de plafond.
        submit_claim(sara, "Plein", [self.line(self.fuel, "5000")])

    def test_above_the_ceiling_when_admin_rh_allows_it(self):
        # Remarque de la réunion (2026-11-16) : Admin RH permet le dépassement pour l'hôtel (Grade E : 400 par nuit).
        ExpenseCategory.objects.filter(pk=self.hotel.pk).update(above_ceiling_allowed=True)
        self.hotel.refresh_from_db()
        # Sans justification : refusé, le message le demande.
        self.assertIn("expliquez pourquoi", self.errors_of([self.line(self.hotel, "600")])["line_0"][0])
        self.assertIn("expliquez pourquoi", self.errors_of([self.line(self.hotel, "600", justification="   ")])["line_0"][0])
        # Avec : envoyé ; la ligne garde le plafond appliqué, le dépassement et la raison ; le titre le dit.
        claim = submit_claim(self.sara, "Mission", [self.line(self.hotel, "600", justification="Festival, seul hôtel libre"),
                                                    self.line(amount="50", justification="inutile")])
        hotel, taxi = claim.lines.all().order_by("id")
        self.assertEqual((hotel.ceiling, hotel.above_ceiling, hotel.justification), (Decimal("400"), Decimal("200"), "Festival, seul hôtel libre"))
        self.assertEqual((taxi.above_ceiling, taxi.justification), (None, ""))  # sous le plafond : rien à justifier
        self.assertTrue(claim.request.title.endswith("· au-dessus du plafond"))
        # Le barème change plus tard : la note garde le plafond de l'envoi.
        CategoryCeiling.objects.filter(category=self.hotel).update(amount=Decimal("900"))
        hotel.refresh_from_db()
        self.assertEqual(hotel.above_ceiling, Decimal("200"))
        # L'API le montre (la puce orange), et le PDF se fabrique avec.
        line = ClaimSerializer(claim).data["lines"][0]
        self.assertEqual((line["ceiling"], line["above_ceiling"]), (400, 200))
        self.assertEqual(line["justification"], "Festival, seul hôtel libre")
        self.assertTrue(claim_pdf(claim).startswith(b"%PDF"))
        # Une autre catégorie (taxi) ne le permet pas : toujours refusé.
        self.assertIn("(par trajet) pour votre grade", self.errors_of([self.line(amount="500", justification="Urgent")])["line_0"][0])

    def test_maximum_per_day_and_per_trip_are_totals(self):
        # 2026-11-18 : "par jour" = le TOTAL du jour, "par trajet" = toute la mission (Sara, Grade E).
        allowance = ExpenseCategory.objects.get(name__startswith="Indemnité journalière")  # 200 MAD par jour
        day_before = self.yesterday - datetime.timedelta(days=1)
        # Le même jour : 120 + 100 = 220 > 200 -> la 2e ligne dépasse (refusée : la catégorie ne le permet pas).
        errors = self.errors_of([self.line(allowance, "120"), self.line(allowance, "100")])
        self.assertNotIn("line_0", errors)
        self.assertIn("total ce jour-là : 220.00 MAD", errors["line_1"][0])
        # Deux jours différents : 120 + 100, chacun sous 200 par jour -> permis.
        submit_claim(self.sara, "Deux jours", [self.line(allowance, "120"), self.line(allowance, "100", date=day_before)])
        # Transport, 350 MAD par trajet = toute la mission : 200 + 200 sur deux jours = 400 -> la 2e dépasse.
        errors = self.errors_of([self.line(amount="200"), self.line(amount="200", date=day_before)])
        self.assertIn("total cette mission : 400.00 MAD", errors["line_1"][0])
        # Permis avec une raison : seule la ligne qui fait déborder la donne ; elle garde ce qui lui restait (150).
        ExpenseCategory.objects.filter(pk=self.taxi.pk).update(above_ceiling_allowed=True)
        self.taxi.refresh_from_db()
        claim = submit_claim(self.sara, "Mission", [self.line(amount="200"), self.line(amount="200", date=day_before, justification="Grève, taxi long")])
        second = claim.lines.order_by("id").last()
        self.assertEqual((second.ceiling, second.above_ceiling), (Decimal("150"), Decimal("50")))
        # 2026-11-19 : le maximum complet est gardé aussi (350) : "Maximum 350 per trip · already used 200 · +50".
        self.assertEqual(second.maximum, Decimal("350"))

    def test_no_grade_no_ceiling_category(self):
        Employee.objects.filter(pk=self.sara.pk).update(grade=None)  # une ancienne fiche
        sara = Employee.objects.get(pk=self.sara.pk)
        self.assertIn("pas de grade", self.errors_of([self.line(self.hotel, "100")], employee=sara)["line_0"][0])
        submit_claim(sara, "Plein", [self.line(self.fuel, "100")])  # sans plafond : permis

    def test_line_rules(self):
        tomorrow = timezone.localdate() + datetime.timedelta(days=1)
        self.assertIn("futur", self.errors_of([self.line(date=tomorrow)])["line_0"][0])
        # Le justificatif : facultatif par défaut (2026-11-16) ; obligatoire si Admin RH coche la case de la catégorie.
        submit_claim(self.sara, "Sans ticket", [self.line(receipts=[])])
        ExpenseCategory.objects.filter(pk=self.taxi.pk).update(receipt_required=True)
        self.taxi.refresh_from_db()
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
        with self.assertRaises(ValidationError):
            mark_reimbursed(claim, self.nadia.user)  # le N+1 a validé, mais pas encore le contrôle RH
        engine.approve(claim.request.steps.get(status="PENDING"), self.nadia.user)
        with self.assertRaises(PermissionDenied):
            mark_reimbursed(claim, self.youssef.user)  # le N+1 n'est pas RH
        claim = mark_reimbursed(claim, self.nadia.user)
        self.assertEqual((claim.reimbursed_at, claim.reimbursed_by), (timezone.localdate(), self.nadia.user))
        with self.assertRaises(ValidationError):
            mark_reimbursed(claim, self.hind.user)  # déjà remboursée


class CurrencyTests(ClaimTestCase):
    """Remarque des RH (2026-11-16) : un reçu en EUR / USD ; le montant du reçu est converti en MAD au taux du jour."""

    def test_a_line_paid_in_euros_is_converted_to_mad(self):
        eur = Currency.objects.get(name="EUR")
        Currency.objects.filter(pk=eur.pk).update(rate_to_mad=Decimal("10.9553"))
        eur.refresh_from_db()
        claim = submit_claim(self.sara, "Paris", [self.line(amount="20", currency=eur), self.line(self.fuel, "100")])
        line = claim.lines.get(currency=eur)
        self.assertEqual((line.original_amount, line.rate, line.amount), (Decimal("20"), Decimal("10.9553"), Decimal("219.11")))
        self.assertEqual(claim.total, Decimal("319.11"))  # le total en MAD
        # Le taux change demain : la note garde celui de l'envoi.
        Currency.objects.filter(pk=eur.pk).update(rate_to_mad=Decimal("12"))
        line.refresh_from_db()
        self.assertEqual(line.amount, Decimal("219.11"))
        data = ClaimSerializer(claim).data["lines"]
        self.assertEqual((data[0]["currency_code"], data[0]["original_amount"]), ("EUR", 20))
        self.assertTrue(claim_pdf(claim).startswith(b"%PDF"))

    def test_the_ceiling_is_compared_in_mad(self):
        # Grade E, taxi : 350 MAD. 40 EUR = 438,21 MAD -> au-dessus (refusé : la catégorie ne le permet pas).
        eur = Currency.objects.get(name="EUR")
        self.assertIn("(par trajet) pour votre grade", self.errors_of([self.line(amount="40", currency=eur)])["line_0"][0])
        # MAD (ou rien) : le montant tel quel.
        mad = Currency.objects.get(name="MAD")
        line = submit_claim(self.sara, "Rabat", [self.line(amount="100", currency=mad)]).lines.get()
        self.assertEqual((line.amount, line.currency, line.original_amount), (Decimal("100"), None, None))

    def test_rates_are_updated_by_themselves(self):
        # Ce que le site renvoie : combien de devise pour 1 MAD (1 MAD = 0,09128 EUR -> 1 EUR = 10,9553 MAD).
        updated = update_rates({"EUR": Decimal("0.09128"), "USD": Decimal("0.100781"), "MAD": Decimal("1")})
        self.assertEqual(sorted(updated), ["EUR", "USD"])
        self.assertEqual(Currency.objects.get(name="EUR").rate_to_mad, Decimal("10.9553"))
        self.assertIsNotNone(Currency.objects.get(name="EUR").rate_updated_at)
        # Admin RH corrige à la main (décoche "automatique") : l'application n'y touche plus.
        Currency.objects.filter(name="USD").update(automatic=False, rate_to_mad=Decimal("10"))
        update_rates({"EUR": Decimal("0.1"), "USD": Decimal("0.2")})
        self.assertEqual(Currency.objects.get(name="USD").rate_to_mad, Decimal("10"))
        self.assertEqual(Currency.objects.get(name="EUR").rate_to_mad, Decimal("10"))
        self.assertEqual(Currency.objects.get(name="MAD").rate_to_mad, Decimal("1"))  # le MAD ne bouge jamais


class CorrectionTests(ClaimTestCase):
    """Remarque de la réunion (2026-11-16) : un valideur DIMINUE un montant (le ticket dit 150, la ligne dit 200)."""

    def setUp(self):
        super().setUp()
        self.claim = submit_claim(self.sara, "Mission", [self.line(amount="200"), self.line(self.fuel, "300")])
        self.taxi_line = self.claim.lines.get(category=self.taxi)

    def test_the_n_plus_1_reduces_an_amount_with_a_reason(self):
        correct_line(self.taxi_line, self.youssef.user, Decimal("150"), "Le reçu indique 150 MAD")
        self.claim.refresh_from_db()
        self.taxi_line.refresh_from_db()
        self.assertEqual((self.taxi_line.amount, self.claim.total), (Decimal("150"), Decimal("450")))
        self.assertEqual(self.claim.request.title, "Note de frais : Mission (450,00 MAD)")  # le total refait
        trace = self.taxi_line.corrections.get()
        self.assertEqual((trace.old_amount, trace.new_amount, trace.as_role, trace.corrected_by),
                         (Decimal("200"), Decimal("150"), "N+1", self.youssef.user))
        # Sara est prévenue (🔔 + email), avec l'ancien, le nouveau montant et le motif.
        bell = Notification.objects.get(recipient=self.sara.user, kind=Notification.Kind.EXPENSE_CORRECTED)
        self.assertIn("200,00 -> 150,00 MAD. Motif : Le reçu indique 150 MAD", notifications.message(bell))
        self.assertEqual(notifications.link(bell), f"/expenses?open={self.claim.request_id}")  # la note ouverte
        self.assertTrue(claim_pdf(self.claim).startswith(b"%PDF"))  # le PDF montre "Demandé 200,00, corrigé par ..."

    def test_between_zero_and_the_amount_asked_with_a_reason(self):
        with self.assertRaises(ValidationError):
            correct_line(self.taxi_line, self.youssef.user, Decimal("250"), "Plus")  # jamais plus que demandé
        with self.assertRaises(ValidationError):
            correct_line(self.taxi_line, self.youssef.user, Decimal("200"), "Pareil")
        with self.assertRaises(ValidationError):
            correct_line(self.taxi_line, self.youssef.user, Decimal("150"), "   ")  # motif obligatoire
        # 0 = la dépense est refusée (le reste de la note continue).
        correct_line(self.taxi_line, self.youssef.user, Decimal("0"), "Pas de reçu valable")
        self.claim.refresh_from_db()
        self.assertEqual(self.claim.total, Decimal("300"))
        # Une erreur du valideur (2026-11-19) : il remonte, jusqu'au montant demandé (200), jamais au-dessus.
        self.taxi_line.refresh_from_db()
        correct_line(self.taxi_line, self.youssef.user, Decimal("180"), "Le reçu est bon, mon erreur")
        with self.assertRaises(ValidationError):
            correct_line(self.taxi_line, self.youssef.user, Decimal("200.01"), "Plus que demandé")
        correct_line(self.taxi_line, self.youssef.user, Decimal("200"), "Tout le montant")
        self.claim.refresh_from_db()
        self.assertEqual((self.claim.total, self.taxi_line.corrections.count()), (Decimal("500"), 3))

    def test_only_the_person_who_must_answer_now(self):
        with self.assertRaises(PermissionDenied):
            correct_line(self.taxi_line, self.nadia.user, Decimal("150"), "RH trop tôt")  # l'étape RH n'est pas encore là
        with self.assertRaises(PermissionDenied):
            correct_line(self.taxi_line, self.sara.user, Decimal("150"), "Moi-même")
        engine.approve(self.claim.request.steps.get(status="PENDING"), self.youssef.user)
        with self.assertRaises(PermissionDenied):
            correct_line(self.taxi_line, self.youssef.user, Decimal("150"), "Le N+1 a déjà répondu")
        # Le contrôle RH : Nadia corrige ce que le N+1 n'a pas vu.
        correct_line(self.taxi_line, self.nadia.user, Decimal("150"), "Le reçu indique 150 MAD")
        self.assertEqual(self.taxi_line.corrections.get().as_role, "RH")
        engine.approve(self.claim.request.steps.get(status="PENDING"), self.nadia.user)
        with self.assertRaises(PermissionDenied):
            correct_line(self.taxi_line, self.nadia.user, Decimal("100"), "Note déjà acceptée")

    def test_admin_rh_chooses_who_can_correct(self):
        ExpenseSettings.objects.update_or_create(pk=1, defaults={"who_can_correct": "HR_ONLY"})
        self.assertIsNone(correction_role(self.youssef.user, self.claim))
        with self.assertRaises(PermissionDenied):
            correct_line(self.taxi_line, self.youssef.user, Decimal("150"), "Le N+1 n'a pas le droit")
        engine.approve(self.claim.request.steps.get(status="PENDING"), self.youssef.user)
        self.assertEqual(correction_role(self.nadia.user, self.claim), "RH")
        ExpenseSettings.objects.update(who_can_correct="NOBODY")
        self.assertIsNone(correction_role(self.nadia.user, self.claim))

    def test_api(self):
        api = APIClient()
        for employee in (self.sara, self.youssef):
            employee.user.must_change_password = False
            employee.user.save()
        url = reverse("expenses:line-correct", args=[self.taxi_line.pk])
        api.force_authenticate(self.sara.user)
        self.assertFalse(api.get(reverse("expenses:claim-detail", args=[self.claim.request_id])).json()["can_correct"])
        self.assertEqual(api.post(url, {"amount": "150", "reason": "x"}, format="json").status_code, 403)
        api.force_authenticate(self.youssef.user)
        self.assertTrue(api.get(reverse("expenses:claim-detail", args=[self.claim.request_id])).json()["can_correct"])
        self.assertEqual(api.post(url, {"amount": "250", "reason": "x"}, format="json").status_code, 400)
        data = api.post(url, {"amount": "150", "reason": "Le reçu indique 150"}, format="json").json()
        self.assertEqual(data["total"], 450)
        line = next(line for line in data["lines"] if line["id"] == self.taxi_line.pk)
        self.assertEqual((line["amount"], line["corrections"][0]["old_amount"], line["corrections"][0]["as_role"]), (150, 200, "N+1"))
        # Les réglages : Admin RH seulement.
        settings_url = reverse("expenses:settings")
        self.assertEqual(api.get(settings_url).status_code, 403)
        self.youssef.user.role = User.Role.HR_ADMIN
        self.youssef.user.save()
        response = api.patch(settings_url, {"who_can_correct": "HR_ONLY"}, format="json")
        self.assertEqual((response.status_code, response.json()["who_can_correct"]), (200, "HR_ONLY"))
        self.assertEqual(ExpenseSettings.load().updated_by, self.youssef.user)


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
        mine = self.client.get(reverse("expenses:mine-ceilings")).json()["ceilings"]
        self.assertIn({"category": self.hotel.name, "per": "par nuit", "amount": 400}, mine)
        # Le formulaire : chaque catégorie avec le plafond de MON grade.
        hotel = next(c for c in self.client.get(reverse("expenses:category-list")).json() if c["id"] == self.hotel.pk)
        self.assertEqual((hotel["my_ceiling"], hotel["per"]), (400, "NIGHT"))

    def test_my_scale_without_grade_is_still_json(self):
        # Une ancienne fiche sans grade : un objet JSON (pas une réponse vide qui bloque la page).
        Employee.objects.filter(pk=self.sara.pk).update(grade=None)
        self.assertEqual(self.client.get(reverse("expenses:mine-ceilings")).json(), {"grade": None, "ceilings": []})

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
        self.assertEqual(self.client.get(pdf).status_code, 400)  # le N+1 seul ne suffit plus : le contrôle RH d'abord
        engine.approve(claim.request.steps.get(status="PENDING"), self.nadia.user)
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
        self.approve_all(claim)
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
        self.assertEqual(self.client.post(url, {"name": "Visa", "per": "EXPENSE"}, format="json").status_code, 403)
        self.login(self.nadia, User.Role.HR_ADMIN)
        response = self.client.post(url, {"name": "Visa", "per": "TRIP", "receipt_required": False}, format="json")
        self.assertEqual((response.status_code, response.json()["per"]), (201, "TRIP"))
        self.assertIn("Visa", [c["name"] for c in self.client.get(reverse("expenses:category-list")).json()])

    def test_only_admin_rh_changes_the_ceilings(self):
        # 2026-11-18 : un plafond par catégorie et par grade (le tableau de Réglages des notes de frais).
        url = reverse("expenses:ceilings")
        grade = Grade.objects.get(name="Grade E — Employé")
        cell = {"category": self.fuel.pk, "grade": grade.pk, "amount": "300"}
        # Sara (collaboratrice) LIT tous les plafonds ("See all grades"), mais ne les change pas.
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertIn("categories", self.client.get(url).json())
        self.assertEqual(self.client.post(url, cell, format="json").status_code, 403)
        self.login(self.nadia, User.Role.HR_ADMIN)
        self.assertEqual(self.client.post(url, cell, format="json").json()["amount"], 300)
        self.assertIn({"category": self.fuel.pk, "grade": grade.pk, "amount": 300}, self.client.get(url).json()["ceilings"])
        # Le carburant a maintenant un plafond pour le Grade E : 500 est refusé (Sara est Grade E).
        self.assertIn("pour votre grade : 300.00 MAD", self.errors_of([self.line(self.fuel, "500")])["line_0"][0])
        # Vide : plus de plafond pour ce grade.
        self.client.post(url, {**cell, "amount": ""}, format="json")
        self.assertFalse(CategoryCeiling.objects.filter(category=self.fuel, grade=grade).exists())
        self.assertEqual(self.client.post(url, {**cell, "amount": "0"}, format="json").status_code, 400)
