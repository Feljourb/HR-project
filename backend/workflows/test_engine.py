"""Tests du moteur : envoyer une demande (step 4)."""
import datetime

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from employees.models import Department, Director, Employee, Pole
from employees.tests import EmployeeTestCase

from . import engine
from .models import Request, RequestStep, Workflow, WorkflowStep

User = get_user_model()
Approver = WorkflowStep.Approver
Mode = WorkflowStep.Mode
Status = RequestStep.Status


class SubmitTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        # Une petite équipe à SBD : Karim (N+2) > Youssef (N+1) > Sara. Nadia et Hind sont RH.
        self.karim = self.make_employee("karim.n2", "AA100001")
        self.youssef = self.make_employee("youssef.n1", "AA100002", manager=self.karim)
        self.sara = self.make_employee("sara.collab", "AA100003", manager=self.youssef)
        self.nadia = self.make_hr("nadia.rh", "AA100004")
        self.hind = self.make_hr("hind.rh", "AA100005")

    def make_hr(self, username, cin, **fields):
        employee = self.make_employee(username, cin, **fields)
        employee.user.role = User.Role.HR
        employee.user.save()
        return employee

    def set_circuit(self, code, *steps):
        """Change le circuit, comme Admin RH le ferait : set_circuit("LEAVE", ("DG", "VALIDATE"), ...)."""
        workflow = Workflow.objects.get(code=code)
        workflow.steps.all().delete()
        for order, (approver, mode) in enumerate(steps, start=1):
            WorkflowStep.objects.create(workflow=workflow, order=order, approver=approver, mode=mode)

    def steps(self, request):
        """Les étapes d'une demande, en clair : [("MANAGER", "VALIDATE", "PENDING"), ...]."""
        return [(step.approver, step.mode, step.status) for step in request.steps.all()]

    # --- Les 3 circuits de départ -------------------------------------------------------

    def test_leave_waits_for_the_manager(self):
        request = engine.submit("LEAVE", self.sara, "Congé du 10 au 15 novembre")
        self.assertEqual(request.status, Request.Status.IN_PROGRESS)
        self.assertEqual(self.steps(request), [
            (Approver.MANAGER, Mode.VALIDATE, Status.PENDING),   # c'est le tour de Youssef
            (Approver.HR, Mode.INFORM, Status.WAITING),          # pas encore son tour
        ])
        self.assertEqual(request.steps.first().assignee, self.youssef)

    def test_admin_request_waits_for_any_hr_of_the_pole(self):
        request = engine.submit("ADMIN_REQUEST", self.sara, "Attestation de travail")
        step = request.steps.get()
        self.assertEqual((step.approver, step.status), (Approver.HR, Status.PENDING))
        self.assertIsNone(step.assignee)  # pas une personne : n'importe quel RH du pôle

    # --- La photo du circuit ---------------------------------------------------------

    def test_a_request_keeps_its_circuit_when_admin_rh_changes_it(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        self.set_circuit("LEAVE", ("DG", "VALIDATE"))  # Admin RH change le circuit APRÈS l'envoi
        self.assertEqual([step.approver for step in request.steps.all()], [Approver.MANAGER, Approver.HR])

    # --- Sauter une étape sans valideur -------------------------------------------------

    def test_no_n_plus_2_is_skipped(self):
        self.set_circuit("LEAVE", ("MANAGER_2", "VALIDATE"), ("MANAGER", "VALIDATE"))
        request = engine.submit("LEAVE", self.youssef, "Congé")  # Youssef : N+1 = Karim, pas de N+2
        self.assertEqual(self.steps(request), [
            (Approver.MANAGER_2, Mode.VALIDATE, Status.SKIPPED),
            (Approver.MANAGER, Mode.VALIDATE, Status.PENDING),
        ])
        self.assertIsNotNone(request.steps.first().decided_at)  # on garde la trace : sautée, et quand

    def test_a_manager_who_left_is_skipped(self):
        self.youssef.status, self.youssef.departure_date = Employee.Status.LEFT, datetime.date(2026, 6, 1)
        self.youssef.save()
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.assertEqual(request.steps.first().status, Status.SKIPPED)

    # --- Toutes les étapes "Valider" sautées -> la RH valide ------------------------------

    def test_without_validator_the_hr_of_the_pole_validates(self):
        alone = self.make_employee("ali.seul", "AA100006")  # pas de N+1
        request = engine.submit("EXPENSE", alone, "Note de frais")
        self.assertEqual(self.steps(request), [
            (Approver.MANAGER, Mode.VALIDATE, Status.SKIPPED),
            (Approver.HR, Mode.VALIDATE, Status.PENDING),       # ajoutée par la règle
        ])

    def test_leave_without_manager_informs_then_waits_for_hr(self):
        alone = self.make_employee("ali.seul", "AA100006")
        request = engine.submit("LEAVE", alone, "Congé")
        self.assertEqual(self.steps(request), [
            (Approver.MANAGER, Mode.VALIDATE, Status.SKIPPED),
            (Approver.HR, Mode.INFORM, Status.INFORMED),        # informer n'attend personne
            (Approver.HR, Mode.VALIDATE, Status.PENDING),       # ajoutée par la règle
        ])

    # --- Informer -------------------------------------------------------------------------

    def test_inform_does_not_wait(self):
        self.set_circuit("EXPENSE", ("HR", "INFORM"), ("MANAGER", "VALIDATE"))
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.assertEqual([step.status for step in request.steps.all()], [Status.INFORMED, Status.PENDING])

    # --- RH : jamais sa propre demande, seulement son pôle -------------------------------------

    def test_hr_never_validates_their_own_request(self):
        validators = engine.hr_of_pole(self.nadia.pole, self.nadia)
        self.assertNotIn(self.nadia, validators)
        self.assertIn(self.hind, validators)

    def test_hr_of_the_other_pole_does_not_count(self):
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")  # Riaya
        riaya_hr = self.make_hr("rh.riaya", "AA100007", department=production, position=production.positions.first())
        self.assertNotIn(riaya_hr, engine.hr_of_pole(self.sara.pole, self.sara))

    # --- DG ---------------------------------------------------------------------------------

    def test_dg_of_the_pole(self):
        soufiane = Director.objects.create(name="Soufiane Badaa", email="s.badaa@example.com")
        Pole.objects.filter(name="SBD").update(director=soufiane)
        self.set_circuit("EXPENSE", ("DG", "VALIDATE"))
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.assertEqual(request.steps.get().director, soufiane)

    def test_a_pole_without_dg_is_skipped(self):
        self.set_circuit("EXPENSE", ("DG", "VALIDATE"), ("MANAGER", "VALIDATE"))
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.assertEqual([step.status for step in request.steps.all()], [Status.SKIPPED, Status.PENDING])

    # --- Type désactivé ------------------------------------------------------------------------

    def test_a_disabled_type_is_refused(self):
        Workflow.objects.filter(code="LEAVE").update(is_active=False)
        with self.assertRaisesMessage(ValidationError, "Ce type de demande est désactivé."):
            engine.submit("LEAVE", self.sara, "Congé")
        self.assertFalse(Request.objects.exists())
