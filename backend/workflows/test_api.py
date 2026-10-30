"""Tests de l'API des circuits (step 3a) et du DG de chaque pôle (step 3b)."""
import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from employees.models import Employee, Pole
from employees.tests import EmployeeTestCase

from .models import Workflow

User = get_user_model()


def url(pk=None):
    return reverse("workflows:workflow-list") if pk is None else reverse("workflows:workflow-detail", args=[pk])


def step(approver, mode="VALIDATE"):
    return {"approver": approver, "mode": mode}


class WorkflowApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.leave = Workflow.objects.get(code=Workflow.Code.LEAVE)

    def login_as(self, role=User.Role.HR_ADMIN, **fields):
        """Connecte un utilisateur prêt (mot de passe déjà changé) avec ce rôle."""
        user = User.objects.create_user(f"user.{role.lower()}", role=role, must_change_password=False, **fields)
        self.client.force_authenticate(user)
        return user

    def change_steps(self, *steps):
        return self.client.patch(url(self.leave.pk), {"steps": list(steps)}, format="json")

    def circuit(self):
        """Le circuit Congé dans la base : [(1, "MANAGER", "VALIDATE"), ...]."""
        return [(s.order, s.approver, s.mode) for s in self.leave.steps.all()]

    # --- Qui a accès ---------------------------------------------------------------

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(url()).status_code, 401)

    def test_only_hr_admin_and_it(self):
        for role in (User.Role.COLLABORATOR, User.Role.MANAGER, User.Role.HR):
            with self.subTest(role=role):
                self.login_as(role)
                self.assertEqual(self.client.get(url()).status_code, 403)

    def test_it_has_access(self):
        self.login_as(User.Role.COLLABORATOR, is_superuser=True)
        self.assertEqual(self.client.get(url()).status_code, 200)

    # --- Lire ------------------------------------------------------------------------

    def test_list_shows_the_circuits_and_their_steps(self):
        self.login_as()
        circuits = {item["code"]: item for item in self.client.get(url()).json()}
        self.assertEqual(set(circuits), {"LEAVE", "EXPENSE", "ADMIN_REQUEST"})
        self.assertEqual(circuits["LEAVE"]["steps"], [
            {"order": 1, "approver": "MANAGER", "approver_label": "N+1", "mode": "VALIDATE", "mode_label": "Valider"},
            {"order": 2, "approver": "HR", "approver_label": "RH du pôle", "mode": "INFORM", "mode_label": "Informer"},
        ])

    # --- Changer les étapes ------------------------------------------------------------

    def test_the_order_comes_from_the_place_in_the_list(self):
        self.login_as()
        response = self.change_steps(step("HR", "INFORM"), step("DG"), step("MANAGER"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.circuit(), [(1, "HR", "INFORM"), (2, "DG", "VALIDATE"), (3, "MANAGER", "VALIDATE")])
        self.assertEqual([s["order"] for s in response.json()["steps"]], [1, 2, 3])

    def test_remove_a_step(self):
        self.login_as()
        self.change_steps(step("MANAGER"))
        self.assertEqual(self.circuit(), [(1, "MANAGER", "VALIDATE")])

    def test_the_same_approver_twice_is_refused(self):
        self.login_as()
        response = self.change_steps(step("MANAGER"), step("MANAGER", "INFORM"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["steps"], ["Ce valideur est déjà dans le circuit."])
        self.assertEqual(self.circuit(), [(1, "MANAGER", "VALIDATE"), (2, "HR", "INFORM")])  # rien n'a changé

    def test_a_circuit_needs_a_validate_step(self):
        self.login_as()
        for steps in ([step("HR", "INFORM")], []):
            with self.subTest(steps=steps):
                response = self.change_steps(*steps)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["steps"], ["Le circuit doit avoir au moins une étape « Valider »."])

    def test_hr_admin_is_not_an_approver(self):
        self.login_as()
        self.assertEqual(self.change_steps(step("HR_ADMIN")).status_code, 400)

    def test_approver_and_mode_are_required(self):
        self.login_as()
        for incomplete in ({"approver": "MANAGER"}, {"mode": "VALIDATE"}):
            with self.subTest(step=incomplete):
                response = self.change_steps(incomplete)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["steps"], ["Chaque étape a besoin d'un valideur et d'un mode."])

    # --- Le reste du circuit ------------------------------------------------------------

    def test_rename_keeps_the_steps(self):
        self.login_as()
        response = self.client.patch(url(self.leave.pk), {"name": "Congés payés"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.leave.refresh_from_db()
        self.assertEqual(self.leave.name, "Congés payés")
        self.assertEqual(self.leave.code, "LEAVE")
        self.assertEqual(len(self.circuit()), 2)

    def test_duplicate_name_is_refused(self):
        self.login_as()
        response = self.client.patch(url(self.leave.pk), {"name": "note de frais"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["non_field_errors"], ["Cette valeur existe déjà."])

    def test_the_code_never_changes(self):
        self.login_as()
        self.client.patch(url(self.leave.pk), {"code": "EXPENSE"}, format="json")
        self.leave.refresh_from_db()
        self.assertEqual(self.leave.code, "LEAVE")

    def test_deactivate(self):
        self.login_as()
        self.client.patch(url(self.leave.pk), {"is_active": False}, format="json")
        self.leave.refresh_from_db()
        self.assertFalse(self.leave.is_active)

    def test_no_create_and_no_delete(self):
        self.login_as()
        self.assertEqual(self.client.post(url(), {"name": "Recrutement"}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(url(self.leave.pk)).status_code, 405)
        self.assertTrue(Workflow.objects.filter(pk=self.leave.pk).exists())


class PoleDirectorApiTests(EmployeeTestCase):
    """L'API du DG de chaque pôle (step 3b) : le DG est un collaborateur (son dossier RH)."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.sbd = Pole.objects.get(name="SBD")
        self.soufiane = self.make_employee("soufiane.badaa", "DG111111", last_name="Badaa", first_name="Soufiane")

    def login_as(self, role=User.Role.HR_ADMIN):
        user = User.objects.create_user(f"user.{role.lower()}", role=role, must_change_password=False)
        self.client.force_authenticate(user)

    def poles(self, pk=None):
        return reverse("workflows:pole-list") if pk is None else reverse("workflows:pole-detail", args=[pk])

    def choose(self, director_id):
        return self.client.patch(self.poles(self.sbd.pk), {"director": director_id}, format="json")

    def test_only_hr_admin(self):
        self.login_as(User.Role.HR)
        self.assertEqual(self.client.get(self.poles()).status_code, 403)

    def test_choose_the_dg_of_a_pole(self):
        self.login_as()
        response = self.choose(self.soufiane.pk)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"id": self.sbd.pk, "name": "SBD", "director": self.soufiane.pk,
                                           "director_label": str(self.soufiane)})

    def test_remove_the_dg_of_a_pole(self):
        self.login_as()
        self.choose(self.soufiane.pk)
        self.choose(None)
        self.sbd.refresh_from_db()
        self.assertIsNone(self.sbd.director)

    def test_a_left_employee_cannot_be_chosen(self):
        self.login_as()
        gone = self.make_employee("ex.dg", "DG222222", status=Employee.Status.LEFT, departure_date=datetime.date(2026, 6, 1))
        response = self.choose(gone.pk)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["director"], ["Un collaborateur sorti ne peut pas être DG."])

    def test_the_pole_name_does_not_change_here(self):
        self.login_as()
        self.client.patch(self.poles(self.sbd.pk), {"name": "Autre nom"}, format="json")
        self.sbd.refresh_from_db()
        self.assertEqual(self.sbd.name, "SBD")