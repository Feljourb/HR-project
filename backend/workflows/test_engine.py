"""Tests du moteur : envoyer une demande (step 4), puis décider (step 5)."""
import datetime

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError

from employees.models import Department, Employee, Pole
from employees.tests import EmployeeTestCase

from . import engine
from .models import Request, RequestStep, Workflow, WorkflowStep

User = get_user_model()
Approver = WorkflowStep.Approver
Mode = WorkflowStep.Mode
Status = RequestStep.Status


class EngineTestCase(EmployeeTestCase):
    """L'équipe commune aux tests du moteur, et les petites aides."""

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


class SubmitTests(EngineTestCase):
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
        validators = engine.hr_validators(self.nadia)
        self.assertNotIn(self.nadia.user, validators)
        self.assertIn(self.hind.user, validators)

    def test_hr_of_the_other_pole_does_not_count(self):
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")  # Riaya
        riaya_hr = self.make_hr("rh.riaya", "AA100007", department=production, position=production.positions.first())
        self.assertNotIn(riaya_hr.user, engine.hr_validators(self.sara))

    # --- DG ---------------------------------------------------------------------------------

    def test_dg_of_the_pole_answers_like_a_manager(self):
        # Le DG est un collaborateur (dossier + compte), tout en haut : le N+1 de Karim.
        soufiane = self.make_employee("soufiane.dg", "AA100011", first_name="Soufiane", last_name="Badaa")
        Pole.objects.filter(name="SBD").update(director=soufiane)
        self.set_circuit("EXPENSE", ("DG", "VALIDATE"))
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.assertEqual(request.steps.get().assignee, soufiane)
        engine.approve(request.steps.get(), soufiane.user)
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.APPROVED)

    def test_the_dg_never_validates_their_own_request(self):
        soufiane = self.make_employee("soufiane.dg", "AA100011", first_name="Soufiane", last_name="Badaa")
        Pole.objects.filter(name="SBD").update(director=soufiane)
        self.set_circuit("EXPENSE", ("DG", "VALIDATE"))
        request = engine.submit("EXPENSE", soufiane, "Note de frais du DG")
        # Étape DG sautée (pas sa propre demande) -> la règle ajoute "RH du pôle valide".
        self.assertEqual(self.steps(request), [
            (Approver.DG, Mode.VALIDATE, Status.SKIPPED),
            (Approver.HR, Mode.VALIDATE, Status.PENDING),
        ])

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


class DecideTests(EngineTestCase):
    """Valider, refuser, annuler (step 5)."""

    def pending(self, request):
        """L'étape qui attend une réponse."""
        return request.steps.get(status=Status.PENDING)

    # --- Valider ---------------------------------------------------------------------------

    def test_manager_approves_then_hr_is_informed_and_the_leave_is_approved(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        engine.approve(self.pending(request), self.youssef.user, "Bon repos")
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.APPROVED)
        self.assertIsNotNone(request.closed_at)
        self.assertEqual(self.steps(request), [
            (Approver.MANAGER, Mode.VALIDATE, Status.APPROVED),
            (Approver.HR, Mode.INFORM, Status.INFORMED),
        ])
        # L'historique : qui, quand, quel commentaire.
        first = request.steps.first()
        self.assertEqual((first.decided_by, first.comment), (self.youssef.user, "Bon repos"))
        self.assertIsNotNone(first.decided_at)

    def test_the_comment_is_optional_to_approve(self):
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        engine.approve(self.pending(request), self.youssef.user)
        self.assertEqual(request.steps.first().comment, "")

    def test_two_validate_steps_one_after_the_other(self):
        self.set_circuit("LEAVE", ("MANAGER", "VALIDATE"), ("MANAGER_2", "VALIDATE"))
        request = engine.submit("LEAVE", self.sara, "Congé")
        engine.approve(self.pending(request), self.youssef.user)
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.IN_PROGRESS)  # pas fini : c'est le tour de Karim
        self.assertEqual(self.pending(request).assignee, self.karim)
        engine.approve(self.pending(request), self.karim.user)
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.APPROVED)

    # --- Qui peut répondre --------------------------------------------------------------------

    def test_only_the_right_person_can_answer(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        step = self.pending(request)
        for intruder in (self.sara, self.karim, self.nadia):  # la demandeuse, le N+2, une RH
            with self.subTest(user=intruder.user.username), self.assertRaises(PermissionDenied):
                engine.approve(step, intruder.user)

    def test_any_hr_of_the_pole_but_not_the_requester(self):
        request = engine.submit("ADMIN_REQUEST", self.nadia, "Attestation de travail")  # Nadia est RH
        with self.assertRaises(PermissionDenied):
            engine.approve(self.pending(request), self.nadia.user)  # pas sa propre demande
        engine.approve(self.pending(request), self.hind.user)       # une autre RH du pôle : oui
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.APPROVED)

    def test_hr_of_the_other_pole_cannot_answer(self):
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        riaya_hr = self.make_hr("rh.riaya", "AA100007", department=production, position=production.positions.first())
        request = engine.submit("ADMIN_REQUEST", self.sara, "Attestation de travail")
        with self.assertRaises(PermissionDenied):
            engine.approve(self.pending(request), riaya_hr.user)

    def test_a_step_already_answered_cannot_be_answered_again(self):
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        step = self.pending(request)
        engine.approve(step, self.youssef.user)
        with self.assertRaisesMessage(ValidationError, "Cette étape n'attend plus de réponse."):
            engine.approve(step, self.youssef.user)

    # --- Refuser --------------------------------------------------------------------------------

    def test_reject_needs_a_comment(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        with self.assertRaisesMessage(ValidationError, "Un commentaire est obligatoire pour refuser."):
            engine.reject(self.pending(request), self.youssef.user, "   ")
        self.assertEqual(self.pending(request).status, Status.PENDING)  # rien n'a changé

    def test_reject_stops_the_request(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        engine.reject(self.pending(request), self.youssef.user, "Période chargée")
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.REJECTED)
        self.assertEqual(self.steps(request), [
            (Approver.MANAGER, Mode.VALIDATE, Status.REJECTED),
            (Approver.HR, Mode.INFORM, Status.WAITING),   # jamais atteinte : la RH n'est pas informée
        ])
        self.assertEqual(request.steps.first().comment, "Période chargée")

    # --- Annuler ----------------------------------------------------------------------------------

    def test_the_requester_cancels(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        engine.cancel(request, self.sara.user)
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.CANCELLED)
        # Après l'annulation, Youssef ne peut plus répondre.
        with self.assertRaises(ValidationError):
            engine.approve(request.steps.first(), self.youssef.user)

    def test_only_the_requester_can_cancel(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        with self.assertRaises(PermissionDenied):
            engine.cancel(request, self.youssef.user)

    def test_a_finished_request_cannot_be_cancelled(self):
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        engine.approve(self.pending(request), self.youssef.user)
        with self.assertRaisesMessage(ValidationError, "Cette demande est déjà terminée."):
            engine.cancel(request, self.sara.user)

    # --- Passer la main au module ---------------------------------------------------------------------

    def test_the_module_is_called_once_when_the_request_is_approved(self):
        called = []
        engine.HANDLERS["EXPENSE"] = called.append          # un faux module "Note de frais"
        self.addCleanup(engine.HANDLERS.pop, "EXPENSE")      # on le retire après le test
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.assertEqual(called, [])                         # pas encore acceptée
        engine.approve(self.pending(request), self.youssef.user)
        self.assertEqual(called, [request])

    def test_the_module_is_not_called_when_the_request_is_rejected(self):
        called = []
        engine.HANDLERS["EXPENSE"] = called.append
        self.addCleanup(engine.HANDLERS.pop, "EXPENSE")
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        engine.reject(self.pending(request), self.youssef.user, "Justificatif manquant")
        self.assertEqual(called, [])


class AdminRhIsHrTests(EngineTestCase):
    """Une Admin RH est une RH des deux pôles : elle répond aux étapes "RH du pôle" comme une RH."""

    def setUp(self):
        super().setUp()
        self.admin_rh = User.objects.create_user("admin.rh", role=User.Role.HR_ADMIN, must_change_password=False)
        # Salma est la SEULE RH du pôle Riaya.
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        self.salma = self.make_hr("salma.rh", "AA100008", department=production, position=production.positions.first())

    def test_the_only_hr_of_a_pole_is_validated_by_admin_rh(self):
        request = engine.submit("ADMIN_REQUEST", self.salma, "Attestation de Salma")
        self.assertEqual(request.steps.get().status, Status.PENDING)  # pas sautée : l'Admin RH est là
        self.assertEqual(list(engine.steps_waiting_for(self.admin_rh)), [request.steps.get()])
        engine.approve(request.steps.get(), self.admin_rh)
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.APPROVED)

    def test_admin_rh_sees_the_hr_steps_of_both_poles(self):
        engine.submit("ADMIN_REQUEST", self.sara, "Attestation de Sara")    # SBD
        engine.submit("ADMIN_REQUEST", self.salma, "Attestation de Salma")  # Riaya
        titles = [step.request.title for step in engine.steps_waiting_for(self.admin_rh)]
        self.assertEqual(sorted(titles), ["Attestation de Salma", "Attestation de Sara"])

    def test_admin_rh_does_not_see_the_manager_steps(self):
        engine.submit("LEAVE", self.sara, "Congé de Sara")  # attend Youssef (N+1), pas la RH
        self.assertEqual(list(engine.steps_waiting_for(self.admin_rh)), [])

    def test_an_hr_of_another_pole_still_cannot_answer(self):
        request = engine.submit("ADMIN_REQUEST", self.salma, "Attestation de Salma")
        with self.assertRaises(PermissionDenied):
            engine.approve(request.steps.get(), self.nadia.user)  # RH de SBD

    def test_admin_rh_never_validates_their_own_request(self):
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        admin_fiche = self.make_employee("admin.riaya", "AA100009", department=production, position=production.positions.first())
        admin_fiche.user.role = User.Role.HR_ADMIN
        admin_fiche.user.save()
        request = engine.submit("ADMIN_REQUEST", admin_fiche, "Attestation de l'Admin RH")
        step = request.steps.get()
        self.assertFalse(engine.can_decide(admin_fiche.user, step))  # pas sa propre demande
        self.assertTrue(engine.can_decide(self.admin_rh, step))       # une autre Admin RH : oui
        self.assertTrue(engine.can_decide(self.salma.user, step))     # la RH du pôle : oui

    def test_nobody_left_is_skipped_then_hr_step_added(self):
        """Ni autre RH, ni Admin RH : l'étape RH est sautée (personne), la règle ajoute une étape RH."""
        self.admin_rh.delete()
        request = engine.submit("ADMIN_REQUEST", self.salma, "Attestation de Salma")
        self.assertEqual([step.status for step in request.steps.all()], [Status.SKIPPED, Status.PENDING])