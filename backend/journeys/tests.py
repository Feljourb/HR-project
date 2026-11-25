"""Tests des arrivées et départs : le modèle copié, qui fait quoi, "Fait", la cloche, les droits, l'API."""
from datetime import timedelta
from decimal import Decimal

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Notification, Pole
from employees.notifications import message, refresh_for
from workflows import engine
from workflows.models import Request
from workflows.test_engine import EngineTestCase

from employees.models import Category

from . import exit_summary, notice, services
from .models import Departure, DepartureType, Journey, JourneySettings, Kind, Owner, TaskTemplate

MEDIA = tempfile.mkdtemp()  # les lettres des tests : un dossier jetable, jamais backend/media

User = get_user_model()
N = Notification.Kind


class JourneyTestCase(EngineTestCase):
    """Sara (Ventes, SBD) arrive dans 10 jours ; son N+1 est Youssef ; Nadia et Hind sont RH de SBD."""

    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.sara.hire_date = self.today + timedelta(days=10)
        self.sara.save()
        for employee in (self.sara, self.youssef, self.nadia, self.hind, self.karim):
            employee.user.must_change_password = False
            employee.user.save()
        # La lettre obligatoire pour une démission (réglage, OUI par défaut) : testée à part (ExitProcedureTests).
        JourneySettings.objects.update_or_create(pk=1, defaults={"letter_required": False})

    def task(self, journey, name):
        return journey.tasks.get(name=name)


class StartTests(JourneyTestCase):
    def test_the_model_is_copied_with_real_dates_and_people(self):
        journey = services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        self.assertEqual(journey.day, self.sara.hire_date)  # l'arrivée suit la date d'embauche
        self.assertEqual(journey.tasks.count(), TaskTemplate.objects.filter(kind=Kind.ARRIVAL, is_active=True).count())
        contract = self.task(journey, "Préparer le contrat de travail")
        self.assertEqual((contract.owner, contract.person, contract.due_date), (Owner.HR, None, self.sara.hire_date - timedelta(days=5)))
        desk = self.task(journey, "Préparer le bureau et choisir un parrain")
        self.assertEqual((desk.owner, desk.person), (Owner.MANAGER, self.youssef))  # le N+1, lu dans l'organigramme
        papers = self.task(journey, "Apporter les documents : CIN, RIB, photo, diplômes")
        self.assertEqual(papers.person, self.sara)
        # 🔔 une notification par personne qui a une tâche : Youssef, Sara, et les RH du pôle.
        told = set(Notification.objects.filter(kind=N.JOURNEY_TASKS).values_list("recipient__username", flat=True))
        self.assertEqual(told, {"youssef.n1", "sara.collab", "nadia.rh", "hind.rh"})
        note = Notification.objects.get(kind=N.JOURNEY_TASKS, recipient=self.youssef.user)
        self.assertIn("vous avez 2 tâche(s) à faire", message(note))

    def test_a_chosen_person_does_the_task_and_no_manager_goes_to_hr(self):
        TaskTemplate.objects.filter(name__startswith="Préparer le PC").update(owner=Owner.PERSON, person=self.karim)
        alone = self.make_alone("ali.alone", "AA100009", hire_date=self.today + timedelta(days=3))
        journey = services.start(alone, Kind.ARRIVAL, self.nadia.user)
        self.assertEqual(self.task(journey, "Préparer le PC et créer l'email professionnel").person, self.karim)
        # Pas de N+1 : la tâche du manager va aux RH (personne n'est oublié).
        self.assertEqual(self.task(journey, "Préparer le bureau et choisir un parrain").owner, Owner.HR)

    def test_only_one_arrival_and_only_hr_of_the_pole(self):
        services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        with self.assertRaises(ValidationError):
            services.start(self.sara, Kind.ARRIVAL, self.hind.user)
        with self.assertRaises(PermissionDenied):
            services.start(self.youssef, Kind.ARRIVAL, self.sara.user)  # une collaboratrice

    def test_auto_start_only_for_a_new_arrival(self):
        self.assertIsNotNone(services.auto_start(self.sara, self.nadia.user))
        self.youssef.hire_date = self.today - timedelta(days=400)  # déjà là depuis longtemps (fiche saisie après)
        self.assertIsNone(services.auto_start(self.youssef, self.nadia.user))

    def test_the_arrival_moves_with_the_hire_date(self):
        journey = services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        contract = self.task(journey, "Préparer le contrat de travail")
        services.complete(contract, self.nadia.user)
        self.sara.hire_date += timedelta(days=7)
        self.sara.save()
        services.hire_date_changed(self.sara)
        journey.refresh_from_db()
        self.assertEqual(journey.day, self.sara.hire_date)
        badge = self.task(journey, "Préparer le badge d'accès")
        self.assertEqual(badge.due_date, self.sara.hire_date - timedelta(days=2))
        self.assertEqual(self.task(journey, "Préparer le contrat de travail").due_date, contract.due_date)  # déjà faite : garde sa date


class TaskTests(JourneyTestCase):
    def setUp(self):
        super().setUp()
        self.journey = services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        self.desk = self.task(self.journey, "Préparer le bureau et choisir un parrain")

    def test_the_person_ticks_done_with_the_information(self):
        services.complete(self.desk, self.youssef.user, detail="Karim", comment="Bureau 12")
        self.desk.refresh_from_db()
        self.assertEqual((self.desk.detail, self.desk.comment, self.desk.done_by), ("Karim", "Bureau 12", self.youssef.user))
        with self.assertRaises(ValidationError):
            services.complete(self.desk, self.youssef.user)  # déjà faite
        services.reopen(self.desk, self.youssef.user)
        self.desk.refresh_from_db()
        self.assertIsNone(self.desk.done_at)

    def test_someone_else_cannot_tick_but_hr_can(self):
        with self.assertRaises(PermissionDenied):
            services.complete(self.desk, self.sara.user)
        services.complete(self.desk, self.hind.user)  # les RH coordonnent : ils peuvent tout cocher

    def test_all_done_tells_hr(self):
        for task in self.journey.tasks.all():
            services.complete(task, self.nadia.user)
        told = set(Notification.objects.filter(kind=N.JOURNEY_DONE).values_list("recipient__username", flat=True))
        self.assertEqual(told, {"nadia.rh", "hind.rh"})
        self.assertIn("toutes les tâches sont faites", message(Notification.objects.filter(kind=N.JOURNEY_DONE).first()))

    def test_cancel_needs_a_reason_and_hides_the_tasks(self):
        with self.assertRaises(ValidationError):
            services.cancel(self.journey, self.nadia.user, " ")
        services.cancel(self.journey, self.nadia.user, "Pas venu")
        self.assertFalse(services.tasks_of(self.youssef.user).exists())
        with self.assertRaises(ValidationError):
            services.complete(self.desk, self.youssef.user)
        # Une nouvelle arrivée peut recommencer (l'ancienne reste, annulée).
        services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        self.assertEqual(Journey.objects.filter(employee=self.sara).count(), 2)

    def test_a_late_task_rings_the_bell_until_it_is_done(self):
        Journey.objects.filter(pk=self.journey.pk).update(day=self.today - timedelta(days=3))
        self.journey.tasks.update(due_date=self.today - timedelta(days=2))
        refresh_for(self.youssef.user)
        late = Notification.objects.get(recipient=self.youssef.user, kind=N.TASK_LATE)
        self.assertIn("En retard : 2 tâche(s)", message(late))  # ses 2 tâches de manager
        services.complete(self.desk, self.youssef.user)
        self.assertIn("En retard : 1 tâche(s)", message(late))  # recalculé à l'affichage
        services.complete(self.task(self.journey, "Point de fin du premier mois"), self.youssef.user)
        refresh_for(self.youssef.user)
        self.assertFalse(Notification.objects.filter(recipient=self.youssef.user, kind=N.TASK_LATE).exists())


@override_settings(MEDIA_ROOT=MEDIA)
class DepartureTests(JourneyTestCase):
    """Step 2 : Youssef (N+1) déclare le départ de Sara ; les RH valident ; les tâches ; "Sorti" après le dernier jour."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.last_day = self.sara.hire_date + timedelta(days=60)

    def ask(self, user, **fields):
        values = {"departure_type": DepartureType.RESIGNATION, "last_day": self.last_day, **fields}
        return services.request_departure(self.sara, user, values.pop("departure_type"), values.pop("last_day"), **values)

    def approve_all(self, departure):
        """Chaque étape en attente est validée par la bonne personne (le valideur de l'étape, sinon une RH)."""
        while (step := departure.request.steps.filter(status="PENDING").first()) is not None:
            engine.approve(step, step.assignee.user if step.assignee_id else self.nadia.user)

    def test_circuit_the_employee_asks_his_n_plus_1_then_hr(self):
        JourneySettings.objects.update_or_create(pk=1, defaults={"employee_can_request_departure": True})
        departure = self.ask(self.sara.user)
        steps = list(departure.request.steps.order_by("order").values_list("approver", "assignee", "status"))
        self.assertEqual(steps, [("MANAGER", self.youssef.pk, "PENDING"), ("HR", None, "WAITING")])

    def test_circuit_the_manager_who_resigns_is_approved_by_his_own_n_plus_1(self):
        # Youssef (manager) démissionne LUI-MÊME : il est le demandeur, il ne se valide pas ; Karim (son N+1) valide.
        JourneySettings.objects.update_or_create(pk=1, defaults={"employee_can_request_departure": True})
        departure = services.request_departure(self.youssef, self.youssef.user, DepartureType.RESIGNATION, self.last_day)
        steps = list(departure.request.steps.order_by("order").values_list("approver", "assignee", "status"))
        self.assertEqual(steps, [("MANAGER", self.karim.pk, "PENDING"), ("HR", None, "WAITING")])

    def test_circuit_the_reason_of_the_skipped_step_is_kept(self):
        request = engine.submit("DEPARTURE", self.sara, "Départ", initiated_by=self.youssef.user)
        first = request.steps.get(order=1)
        self.assertEqual((first.status, first.comment), ("SKIPPED", "Saisie par cette personne : sa saisie vaut son accord."))

    def test_the_manager_asks_hr_validate_the_tasks_start(self):
        departure = self.ask(self.youssef.user, comment="Lettre reçue", informed=[self.karim])
        self.assertEqual(departure.request.status, Request.Status.IN_PROGRESS)
        self.assertEqual(departure.request.initiated_by, self.youssef.user)
        self.assertIsNone(departure.journey)  # rien avant la validation des RH
        # Youssef (N+1) a saisi : sa saisie vaut son accord, son étape est passée ; les RH valident.
        first = departure.request.steps.get(order=1)
        self.assertEqual((first.approver, first.status), ("MANAGER", "SKIPPED"))
        self.assertEqual(departure.request.steps.get(status="PENDING").approver, "HR")
        self.approve_all(departure)
        departure.refresh_from_db()
        self.assertEqual((departure.journey.kind, departure.journey.day), (Kind.DEPARTURE, self.last_day))
        self.sara.refresh_from_db()
        self.assertEqual((self.sara.departure_date, self.sara.status), (self.last_day, "ACTIVE"))  # Sorti seulement après
        self.assertTrue(departure.journey.tasks.exists())
        self.assertTrue(Notification.objects.filter(recipient=self.karim.user, kind=N.INFORMED).exists())  # à prévenir

    def test_the_employee_goes_through_his_manager_unless_admin_rh_allows_it(self):
        with self.assertRaisesMessage(PermissionDenied, "supérieur hiérarchique"):
            self.ask(self.sara.user)
        with self.assertRaises(PermissionDenied):
            self.ask(self.karim.user)  # le N+2 : pas son manager direct
        client = APIClient()
        client.force_authenticate(self.sara.user)
        self.assertFalse(client.get(reverse("accounts:me")).json()["can_request_departure"])  # pas de lien "My departure"
        JourneySettings.objects.update_or_create(pk=1, defaults={"employee_can_request_departure": True})
        self.assertTrue(client.get(reverse("accounts:me")).json()["can_request_departure"])
        self.assertEqual(self.ask(self.sara.user).request.initiated_by, None)  # lui-même

    def test_hr_record_it_approved_at_once_and_only_one_at_a_time(self):
        departure = self.ask(self.nadia.user, departure_type=DepartureType.END_OF_CONTRACT)
        self.assertEqual(departure.request.status, Request.Status.APPROVED)
        self.assertIsNotNone(departure.journey)
        with self.assertRaisesMessage(ValidationError, "déjà en cours"):
            self.ask(self.youssef.user)

    def test_after_the_last_day_the_employee_is_left_and_blocked(self):
        departure = self.ask(self.nadia.user)
        self.assertEqual(services.close_departures(today=self.last_day), 0)  # le dernier jour : encore là
        self.assertEqual(services.close_departures(today=self.last_day + timedelta(days=1)), 1)
        self.sara.refresh_from_db()
        self.assertEqual(self.sara.status, "LEFT")
        self.assertFalse(self.sara.user.is_active)
        self.assertEqual(departure.employee.history.first().actor_name, "système")

    def test_admin_rh_chooses_hr_block_the_account_by_hand(self):
        JourneySettings.objects.update_or_create(pk=1, defaults={"auto_block": False})
        self.ask(self.nadia.user)
        after = self.last_day + timedelta(days=1)
        self.assertEqual(services.close_departures(today=after), 0)  # l'app ne touche pas la fiche
        self.sara.refresh_from_db()
        self.assertEqual(self.sara.status, "ACTIVE")
        self.assertTrue(self.sara.user.is_active)
        reminders = Notification.objects.filter(kind=N.ACCOUNT_TO_BLOCK, employee=self.sara)
        self.assertTrue(reminders.filter(recipient=self.nadia.user).exists())  # les RH du pôle
        services.close_departures(today=after + timedelta(days=1))  # un autre matin : pas de doublon
        self.assertEqual(reminders.filter(recipient=self.nadia.user).count(), 1)
        # Les RH mettent la fiche en "Sorti" : le rappel pas lu part au tour suivant.
        self.sara.status, self.sara.departure_date = "LEFT", self.last_day
        self.sara.save()
        services.close_departures(today=after + timedelta(days=2))
        self.assertFalse(reminders.exists())

    def test_cancelling_the_departure_removes_the_departure_date(self):
        departure = self.ask(self.nadia.user)
        services.cancel(departure.journey, self.nadia.user, "Il reste finalement")
        self.sara.refresh_from_db()
        self.assertIsNone(self.sara.departure_date)
        # La DEMANDE est annulée aussi (historique "Cancelled by", 🔔 au collaborateur), plus seulement les tâches.
        departure.request.refresh_from_db()
        self.assertEqual((departure.request.status, departure.request.cancel_reason), ("CANCELLED", "Il reste finalement"))
        self.assertTrue(Notification.objects.filter(recipient=self.sara.user, kind=N.CANCELLED, request=departure.request).exists())

    def test_api_form_letter_and_the_managers_view(self):
        client = APIClient()
        client.force_authenticate(self.youssef.user)
        options = client.get(reverse("journeys:departure-options")).json()
        self.assertEqual([member["id"] for member in options["team"]], [self.sara.pk])
        letter = SimpleUploadedFile("demission.pdf", b"%PDF-1.4 lettre", content_type="application/pdf")
        response = client.post(reverse("journeys:departure-list"), {
            "employee": self.sara.pk, "departure_type": "RESIGNATION", "last_day": self.last_day.isoformat(),
            "informed": [self.karim.pk], "letter": letter}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual((data["status"], data["has_letter"], data["informed"]), ("IN_PROGRESS", True, ["Ahmed Alami"]))
        self.assertEqual(len(client.get(reverse("journeys:departure-list")).json()), 1)  # en attente des RH
        letter_url = reverse("journeys:departure-letter", args=[data["id"]])
        self.assertEqual(client.get(letter_url).status_code, 200)
        # La carte de Team approvals : le départ lu par le n° de la demande (RH du pôle : oui).
        card_url = reverse("journeys:departure-by-request", args=[data["request"]])
        client.force_authenticate(self.nadia.user)
        card = client.get(card_url).json()
        self.assertEqual((card["type_label"], card["has_letter"]), ("Démission", True))
        client.force_authenticate(self.karim.user)  # N+2 : ni son manager direct, ni RH, ni dans le circuit
        self.assertEqual(client.get(letter_url).status_code, 404)
        self.assertEqual(client.get(card_url).status_code, 404)
        # Validé : Youssef voit le départ de Sara, mais ne coche que SES tâches.
        self.approve_all(Departure.objects.get())
        client.force_authenticate(self.youssef.user)
        journey = client.get(reverse("journeys:journey-list") + "?kind=DEPARTURE").json()[0]
        handles = {task["owner"]: task["can_handle"] for task in journey["tasks"]}
        self.assertEqual((handles["MANAGER"], handles["HR"], journey["can_cancel"]), (True, False, False))
        self.assertEqual(journey["departure"]["type_label"], "Démission")


class NoticeTests(JourneyTestCase):
    """Le préavis (2026-11-25, art. 43 + décret 2004) : la grille, la photo sur la demande, la décision des RH."""

    def setUp(self):
        super().setUp()
        self.sara.hire_date = self.today - timedelta(days=3 * 365 + 10)  # 3 ans d'ancienneté, catégorie "Employé"
        self.sara.save()

    def declare(self, last_day, departure_type=DepartureType.RESIGNATION):
        return services.request_departure(self.sara, self.youssef.user, departure_type, last_day)

    def test_add_months_keeps_the_end_of_month(self):
        from datetime import date
        self.assertEqual(notice.add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(notice.add_months(date(2026, 11, 25), 1), date(2026, 12, 25))

    def test_an_employee_with_3_years_has_1_month_and_too_early_is_to_decide(self):
        departure = self.declare(self.today + timedelta(days=10))
        self.assertEqual((departure.notice_group, departure.notice_years, departure.notice_amount, departure.notice_unit),
                         ("OTHER", 3, 1, "MONTHS"))
        self.assertEqual(departure.notice_until, notice.add_months(self.today, 1))
        self.assertEqual(departure.notice_status, "")  # à décider par les RH
        self.assertEqual(departure.notice_short_days, (departure.notice_until - departure.last_day).days)

    def test_a_cadre_and_a_last_day_after_the_notice_is_respected(self):
        self.sara.category = Category.objects.get(name="Cadre")
        self.sara.save()
        departure = self.declare(self.today + timedelta(days=100))
        self.assertEqual((departure.notice_group, departure.notice_amount, departure.notice_status), ("EXECUTIVE", 2, "RESPECTED"))

    def test_no_notice_for_the_end_of_a_contract(self):
        departure = self.declare(self.today + timedelta(days=5), DepartureType.END_OF_CONTRACT)
        self.assertEqual((departure.notice_until, departure.notice_status), (None, "NONE"))

    def test_hr_decide_and_can_correct_the_start(self):
        departure = self.declare(self.today + timedelta(days=10))
        with self.assertRaises(PermissionDenied):
            notice.decide(departure, self.youssef.user, "WAIVED")  # le manager voit, ne décide pas
        letter_day = self.today - timedelta(days=30)  # la lettre est arrivée il y a 30 jours
        notice.decide(departure, self.nadia.user, "RESPECTED", start=letter_day)
        departure.refresh_from_db()
        self.assertEqual((departure.notice_start, departure.notice_status, departure.notice_decided_by),
                         (letter_day, "RESPECTED", self.nadia.user))

    def test_leave_balance_at_the_last_day_and_leaves_after_it(self):
        from leaves.balance import balance
        from leaves.models import LeaveType
        from leaves.services import request_leave

        last_day = self.today + timedelta(days=40)
        annual = LeaveType.objects.get(name="Congé annuel")
        # Deux congés déjà demandés : un À CHEVAL sur le dernier jour, un tout APRÈS (des semaines entières : des jours
        # ouvrés, quel que soit le jour de la semaine).
        across = request_leave(self.sara, annual, last_day - timedelta(days=3), last_day + timedelta(days=3))
        after = request_leave(self.sara, annual, last_day + timedelta(days=7), last_day + timedelta(days=13))
        departure = services.request_departure(self.sara, self.nadia.user, DepartureType.RESIGNATION, last_day)
        # Le départ validé : le congé tout APRÈS est annulé par l'app (motif, 🔔 à Sara) ; celui à cheval reste (les RH).
        after.request.refresh_from_db()
        self.assertEqual((after.request.status, after.request.cancelled_by), ("CANCELLED", None))  # par l'application
        self.assertIn("dernier jour le", after.request.cancel_reason)
        bell = Notification.objects.get(recipient=self.sara.user, kind=N.CANCELLED, request=after.request)
        self.assertTrue(message(bell).startswith("Demande annulée automatiquement"))
        summary = exit_summary.leave_at_last_day(departure)
        self.assertEqual(summary["available"], balance(self.sara, today=last_day)["available"])  # le moteur des congés
        self.assertEqual([row["request"] for row in summary["leaves_after"]], [across.request_id])  # les RH décident
        # ... et Sara est prévenue pour le congé à cheval : à elle de l'annuler ou d'en demander un plus court.
        told = Notification.objects.get(recipient=self.sara.user, kind=N.LEAVE_PAST_LAST_DAY, request=across.request)
        self.assertIn("dépasse votre dernier jour", message(told))
        client = APIClient()
        url = reverse("journeys:departure-payroll", args=[departure.pk])
        client.force_authenticate(self.nadia.user)
        self.assertEqual(client.get(url).status_code, 200)
        client.force_authenticate(self.youssef.user)  # le manager : pas un élément de paie pour lui
        self.assertEqual(client.get(url).status_code, 404)

    def test_every_employee_sees_his_own_notice(self):
        client = APIClient()
        client.force_authenticate(self.sara.user)  # même sans le droit de demander son départ
        mine = client.get(reverse("journeys:departure-my-notice")).json()
        self.assertEqual((mine["applies"], mine["amount"], mine["unit"], mine["years"]), (True, 1, "MONTHS", 3))
        it = User.objects.create_user("it.notice", password="x", is_superuser=True, must_change_password=False)
        client.force_authenticate(it)  # pas de fiche : 404
        self.assertEqual(client.get(reverse("journeys:departure-my-notice")).status_code, 404)

    def test_api_preview_rules_and_settings(self):
        client = APIClient()
        client.force_authenticate(self.youssef.user)
        url = reverse("journeys:departure-notice-preview")
        preview = client.get(url, {"employee": self.sara.pk, "type": "RESIGNATION"}).json()
        self.assertEqual((preview["applies"], preview["amount"], preview["unit"], preview["group_label"]),
                         (True, 1, "MONTHS", "Employés et ouvriers"))
        self.assertFalse(client.get(url, {"employee": self.sara.pk, "type": "END_OF_CONTRACT"}).json()["applies"])
        client.force_authenticate(self.karim.user)  # pas son manager direct : 404
        self.assertEqual(client.get(url, {"employee": self.sara.pk, "type": "RESIGNATION"}).status_code, 404)
        # Admin RH : la grille (6 lignes) et les réglages.
        admin = User.objects.create_user("admin.rh.notice", password="x", role=User.Role.HR_ADMIN, must_change_password=False)
        client.force_authenticate(admin)
        rules = client.get(reverse("journeys:notice-rule-list")).json()
        self.assertEqual(len(rules), 6)
        other_1_year = next(rule for rule in rules if rule["group"] == "OTHER" and rule["min_years"] == 1)
        client.patch(reverse("journeys:notice-rule-detail", args=[other_1_year["id"]]), {"amount": 45, "unit": "DAYS"}, format="json")
        response = client.patch(reverse("journeys:settings"), {"notice_types": ["RESIGNATION", "RETIREMENT"]}, format="json")
        self.assertEqual(response.json()["notice_types"], ["RESIGNATION", "RETIREMENT"])
        client.force_authenticate(self.youssef.user)
        preview = client.get(url, {"employee": self.sara.pk, "type": "RESIGNATION"}).json()
        self.assertEqual((preview["amount"], preview["unit"]), (45, "DAYS"))  # la nouvelle grille, tout de suite


@override_settings(MEDIA_ROOT=MEDIA)
class ExitProcedureTests(JourneyTestCase):
    """La procédure complète (2026-11-25) : lettre, faute grave, indemnité en heures, documents de sortie, entretien de
    sortie (confidentiel), le lien "My departure", ce que la paie doit savoir."""

    def setUp(self):
        super().setUp()
        self.sara.hire_date = self.today - timedelta(days=3 * 365 + 10)  # ~3 ans d'ancienneté
        self.sara.save()
        self.last_day = self.today + timedelta(days=40)

    def letter(self):
        return SimpleUploadedFile("demission.pdf", b"%PDF-1.4 lettre", content_type="application/pdf")

    def test_a_resignation_needs_the_letter_when_admin_rh_asks_it(self):
        JourneySettings.objects.update_or_create(pk=1, defaults={"letter_required": True})
        with self.assertRaisesMessage(ValidationError, "lettre de démission"):
            services.request_departure(self.sara, self.youssef.user, DepartureType.RESIGNATION, self.last_day)
        departure = services.request_departure(self.sara, self.youssef.user, DepartureType.RESIGNATION, self.last_day, letter=self.letter())
        services.mark_letter_original(departure, self.nadia.user, True)  # l'original papier, noté par les RH
        self.assertIsNotNone(departure.letter_original_at)
        with self.assertRaises(PermissionDenied):
            services.mark_letter_original(departure, self.youssef.user, False)

    def test_dismissal_indemnity_in_hours_and_serious_misconduct(self):
        departure = services.request_departure(self.sara, self.nadia.user, DepartureType.DISMISSAL, self.last_day)
        indemnity = exit_summary.dismissal_indemnity(departure)
        months = exit_summary.months_between(self.sara.hire_date, self.last_day)
        self.assertTrue(indemnity["applies"])
        self.assertEqual(indemnity["hours"], (Decimal(months) / 12 * 96).quantize(Decimal("0.01")))  # moins de 5 ans : 96 h / an
        services.cancel(departure.journey, self.nadia.user, "Test")
        serious = services.request_departure(self.sara, self.nadia.user, DepartureType.DISMISSAL, self.last_day, serious_misconduct=True)
        self.assertEqual(serious.notice_status, "NONE")  # faute grave : ni préavis...
        self.assertFalse(exit_summary.dismissal_indemnity(serious)["applies"])  # ... ni indemnité

    def test_notice_not_respected_gives_days_to_deduct(self):
        departure = services.request_departure(self.sara, self.youssef.user, DepartureType.RESIGNATION, self.today + timedelta(days=10))
        notice.decide(departure, self.nadia.user, "NOT_RESPECTED")
        self.assertEqual(exit_summary.notice_days_to_deduct(departure), departure.notice_short_days)
        self.assertGreater(departure.notice_short_days, 0)

    def test_approval_asks_the_exit_documents_and_invites_to_the_exit_interview(self):
        from documents.models import DocumentRequest

        departure = services.request_departure(self.sara, self.nadia.user, DepartureType.RESIGNATION, self.last_day)
        documents = DocumentRequest.objects.filter(request=departure.exit_request)
        self.assertEqual(sorted(documents.values_list("doc_type__name", flat=True)),
                         ["Certificat de travail", "Reçu pour solde de tout compte"])
        self.assertEqual(set(documents.values_list("due_date", flat=True)), {self.last_day + timedelta(days=8)})  # art. 72
        bell = Notification.objects.get(recipient=self.sara.user, kind=N.EXIT_INTERVIEW)
        self.assertIn("entretien de sortie", message(bell))
        # L'entretien : Sara répond (la question obligatoire d'abord) ; le manager ne le voit jamais ; les RH oui.
        client = APIClient()
        url = reverse("journeys:departure-exit-interview", args=[departure.pk])
        client.force_authenticate(self.sara.user)
        questions = client.get(url).json()["questions"]
        first = next(question for question in questions if question["required"])
        self.assertEqual(client.post(url, {"answers": {}}, format="json").status_code, 400)
        response = client.post(url, {"answers": {str(first["id"]): first["choices"][0]}}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        client.force_authenticate(self.youssef.user)
        self.assertEqual(client.get(url).status_code, 404)  # confidentiel
        client.force_authenticate(self.nadia.user)
        self.assertEqual(client.get(url).json()["answers"], {str(first["id"]): first["choices"][0]})

    def test_my_departure_link_and_payroll_summary(self):
        client = APIClient()
        client.force_authenticate(self.sara.user)
        self.assertFalse(client.get(reverse("accounts:me")).json()["can_request_departure"])
        departure = services.request_departure(self.sara, self.youssef.user, DepartureType.RESIGNATION, self.last_day)
        self.assertTrue(client.get(reverse("accounts:me")).json()["can_request_departure"])  # un départ la concerne
        client.force_authenticate(self.nadia.user)
        data = client.get(reverse("journeys:departure-payroll", args=[departure.pk])).json()
        self.assertEqual(set(data), {"leave", "notice", "indemnity", "cnss"})
        self.assertEqual(data["cnss"]["cin"], self.sara.cin)


class ApiTests(JourneyTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def as_user(self, user):
        self.client.force_authenticate(user)

    def test_hr_starts_and_follows_an_arrival(self):
        self.as_user(self.nadia.user)
        response = self.client.post(reverse("journeys:journey-list"), {"employee": self.sara.pk}, format="json")
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual((data["kind"], data["status"], data["employee"]["id"]), ("ARRIVAL", "open", self.sara.pk))
        # Deux fois : refusé avec un message clair.
        again = self.client.post(reverse("journeys:journey-list"), {"employee": self.sara.pk}, format="json")
        self.assertEqual(again.status_code, 400)
        rows = self.client.get(reverse("journeys:journey-list")).json()
        self.assertEqual([row["id"] for row in rows], [data["id"]])
        # Annuler : le motif est obligatoire.
        url = reverse("journeys:journey-cancel", args=[data["id"]])
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"reason": "Pas venu"}, format="json").json()["status"], "cancelled")

    def test_the_manager_sees_and_ticks_his_tasks_only(self):
        journey = services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        self.as_user(self.youssef.user)
        # Le manager voit l'arrivée de son équipe (en lecture : pas "Cancel").
        self.assertEqual([row["can_cancel"] for row in self.client.get(reverse("journeys:journey-list")).json()], [False])
        tasks = self.client.get(reverse("journeys:task-list")).json()
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0]["journey"]["employee"]["id"], self.sara.pk)
        done = self.client.post(reverse("journeys:task-done", args=[tasks[0]["id"]]), {"detail": "Karim"}, format="json")
        self.assertEqual(done.status_code, 200)
        self.assertEqual(len(self.client.get(reverse("journeys:task-list")).json()), 1)
        self.assertEqual(len(self.client.get(reverse("journeys:task-list") + "?status=done").json()), 1)
        # La tâche d'un autre : 404 (elle n'est pas dans MES tâches).
        other = self.task(journey, "Préparer le contrat de travail")
        self.assertEqual(self.client.post(reverse("journeys:task-done", args=[other.pk])).status_code, 404)

    def test_hr_of_the_other_pole_does_not_see_it(self):
        services.start(self.sara, Kind.ARRIVAL, self.nadia.user)
        riaya = Pole.objects.exclude(pk=self.sara.pole.pk).get()
        other = self.make_employee("rh.riaya", "AA100010", department=self.riaya_department(riaya),
                                   position=self.riaya_department(riaya).positions.first())
        other.user.role, other.user.must_change_password = User.Role.HR, False
        other.user.save()
        self.as_user(other.user)
        self.assertEqual(self.client.get(reverse("journeys:journey-list")).json(), [])
        self.assertEqual(self.client.get(reverse("journeys:task-list")).json(), [])

    def riaya_department(self, pole):
        from employees.models import Department
        return Department.objects.filter(direction__entity__pole=pole, positions__isnull=False).first()

    def test_only_admin_rh_changes_the_model(self):
        url = reverse("journeys:template-list")
        self.as_user(self.nadia.user)
        self.assertEqual(self.client.get(url + "?kind=ARRIVAL").status_code, 200)
        self.assertEqual(self.client.post(url, {"kind": "ARRIVAL", "name": "X", "owner": "HR"}, format="json").status_code, 403)
        admin = User.objects.create_user("admin.rh", role=User.Role.HR_ADMIN, must_change_password=False)
        self.as_user(admin)
        # "Une personne choisie" sans personne : refusé ; avec Karim : OK.
        body = {"kind": "ARRIVAL", "name": "  Préparer   la voiture ", "owner": "PERSON", "offset_days": -1}
        self.assertEqual(self.client.post(url, body, format="json").status_code, 400)
        created = self.client.post(url, {**body, "person": self.karim.pk}, format="json").json()
        self.assertEqual((created["name"], created["person"]), ("Préparer la voiture", self.karim.pk))
        # Passer à "RH du pôle" enlève la personne.
        changed = self.client.patch(reverse("journeys:template-detail", args=[created["id"]]), {"owner": "HR"}, format="json").json()
        self.assertIsNone(changed["person"])
