"""Tests de l'API des circuits (step 3a) et des DG (step 3b)."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from employees.models import Director, Pole

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


class DirectorApiTests(TestCase):
    """L'API des DG et du DG de chaque pôle (step 3b)."""

    def setUp(self):
        self.client = APIClient()
        self.sbd = Pole.objects.get(name="SBD")
        self.soufiane = Director.objects.create(name="Soufiane Badaa", email="s.badaa@example.com")

    def login_as(self, role=User.Role.HR_ADMIN):
        user = User.objects.create_user(f"user.{role.lower()}", role=role, must_change_password=False)
        self.client.force_authenticate(user)

    def directors(self, pk=None):
        return reverse("workflows:director-list") if pk is None else reverse("workflows:director-detail", args=[pk])

    def poles(self, pk=None):
        return reverse("workflows:pole-list") if pk is None else reverse("workflows:pole-detail", args=[pk])

    def choose(self, director_id):
        return self.client.patch(self.poles(self.sbd.pk), {"director": director_id}, format="json")

    # --- Qui a accès ---------------------------------------------------------------

    def test_only_hr_admin(self):
        self.login_as(User.Role.HR)
        self.assertEqual(self.client.get(self.directors()).status_code, 403)
        self.assertEqual(self.client.get(self.poles()).status_code, 403)

    # --- Les DG ----------------------------------------------------------------------

    def test_add_a_dg(self):
        self.login_as()
        response = self.client.post(self.directors(), {"name": "Karim Idrissi", "email": "k.idrissi@example.com"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["is_active"])

    def test_the_same_email_twice_is_refused(self):
        self.login_as()
        response = self.client.post(self.directors(), {"name": "Autre", "email": "s.badaa@example.com"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["email"], ["Cet e-mail existe déjà."])

    def test_a_dg_is_never_deleted(self):
        self.login_as()
        self.assertEqual(self.client.delete(self.directors(self.soufiane.pk)).status_code, 405)

    def test_cannot_deactivate_the_dg_of_a_pole(self):
        self.login_as()
        self.choose(self.soufiane.pk)
        response = self.client.patch(self.directors(self.soufiane.pk), {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["is_active"], ["Ce DG est encore DG de : SBD. Choisissez d'abord un autre DG."])

    def test_deactivate_a_dg_of_no_pole(self):
        self.login_as()
        response = self.client.patch(self.directors(self.soufiane.pk), {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["is_active"])

    # --- Le DG de chaque pôle ------------------------------------------------------------

    def test_choose_the_dg_of_a_pole(self):
        self.login_as()
        response = self.choose(self.soufiane.pk)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"id": self.sbd.pk, "name": "SBD", "director": self.soufiane.pk})

    def test_remove_the_dg_of_a_pole(self):
        self.login_as()
        self.choose(self.soufiane.pk)
        self.choose(None)
        self.sbd.refresh_from_db()
        self.assertIsNone(self.sbd.director)

    def test_an_inactive_dg_cannot_be_chosen(self):
        self.login_as()
        former = Director.objects.create(name="Ancien DG", email="ancien@example.com", is_active=False)
        response = self.choose(former.pk)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["director"], ["Ce DG est désactivé."])

    def test_the_pole_name_does_not_change_here(self):
        self.login_as()
        self.client.patch(self.poles(self.sbd.pk), {"name": "Autre nom"}, format="json")
        self.sbd.refresh_from_db()
        self.assertEqual(self.sbd.name, "SBD")