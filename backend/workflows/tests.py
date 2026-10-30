"""Tests de la configuration des circuits (step 1) et du DG de chaque pôle (step 2)."""
import datetime

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from employees.models import Employee, Pole
from employees.tests import EmployeeTestCase

from .models import Workflow, WorkflowStep

Approver = WorkflowStep.Approver
Mode = WorkflowStep.Mode


def circuit(code):
    """Le circuit d'un type, en clair : [("MANAGER", "VALIDATE"), ("HR", "INFORM")]."""
    return [(step.approver, step.mode) for step in Workflow.objects.get(code=code).steps.all()]


class StandardCircuitsTests(TestCase):
    """Les 3 circuits créés par la migration 0002."""

    def test_leave(self):
        self.assertEqual(circuit(Workflow.Code.LEAVE), [(Approver.MANAGER, Mode.VALIDATE), (Approver.HR, Mode.INFORM)])

    def test_expense(self):
        self.assertEqual(circuit(Workflow.Code.EXPENSE), [(Approver.MANAGER, Mode.VALIDATE)])

    def test_admin_request(self):
        self.assertEqual(circuit(Workflow.Code.ADMIN_REQUEST), [(Approver.HR, Mode.VALIDATE)])


class WorkflowStepRulesTests(TestCase):
    def setUp(self):
        # Le circuit Congé de la migration : 1. N+1 valide, 2. RH informée.
        self.leave = Workflow.objects.get(code=Workflow.Code.LEAVE)

    def add(self, order, approver, workflow=None):
        """Ajoute une étape en passant par les règles du modèle (comme un formulaire)."""
        step = WorkflowStep(workflow=workflow or self.leave, order=order, approver=approver)
        step.full_clean()
        step.save()
        return step

    def test_a_new_step_validates_by_default(self):
        self.assertEqual(self.add(3, Approver.DG).mode, Mode.VALIDATE)

    def test_two_steps_at_the_same_position_are_refused(self):
        with self.assertRaisesMessage(ValidationError, "Il y a déjà une étape à cette position."):
            self.add(1, Approver.DG)

    def test_the_same_approver_twice_is_refused(self):
        with self.assertRaisesMessage(ValidationError, "Ce valideur est déjà dans le circuit."):
            self.add(3, Approver.MANAGER)

    def test_order_starts_at_one(self):
        with self.assertRaises(ValidationError):
            self.add(0, Approver.DG)

    def test_another_workflow_has_its_own_steps(self):
        """Position 1 et N+1 existent dans Congé ET dans Note de frais : pas de conflit."""
        expense = Workflow.objects.get(code=Workflow.Code.EXPENSE)
        self.assertEqual(expense.steps.get(order=1).approver, Approver.MANAGER)

    def test_workflow_names_are_unique_ignoring_case(self):
        with self.assertRaisesMessage(ValidationError, "Cette valeur existe déjà."):
            Workflow(name="congé", code=Workflow.Code.LEAVE).validate_constraints()


class PoleDirectorTests(EmployeeTestCase):
    """Le DG de chaque pôle (step 2) : un collaborateur comme les autres (décision de l'encadrant)."""

    def setUp(self):
        super().setUp()
        self.sbd = Pole.objects.get(name="SBD")
        self.riaya = Pole.objects.get(name="Riaya")
        # Le DG a un dossier RH et un compte "Manager", tout en haut de l'organigramme (pas de N+1).
        self.soufiane = self.make_employee("soufiane.badaa", "DG111111", last_name="Badaa", first_name="Soufiane")

    def choose(self, pole, director):
        """Admin RH choisit le DG (en passant par les règles du modèle)."""
        pole.director = director
        pole.full_clean()
        pole.save()

    def test_a_pole_has_no_dg_at_first(self):
        self.assertIsNone(self.sbd.director)

    def test_the_same_person_can_be_dg_of_both_poles(self):
        self.choose(self.sbd, self.soufiane)
        self.choose(self.riaya, self.soufiane)
        self.assertEqual(set(self.soufiane.directed_poles.all()), {self.sbd, self.riaya})

    def test_a_left_employee_cannot_be_dg(self):
        gone = self.make_employee("ex.dg", "DG222222", status=Employee.Status.LEFT, departure_date=datetime.date(2026, 6, 1))
        with self.assertRaisesMessage(ValidationError, "Un collaborateur sorti ne peut pas être DG."):
            self.choose(self.sbd, gone)

    def test_the_lists_api_does_not_show_the_dg(self):
        """Le DG se choisit dans l'écran Workflows, pas dans la liste des pôles."""
        self.choose(self.sbd, self.soufiane)
        user = get_user_model().objects.create_user("collab", must_change_password=False)
        client = APIClient()
        client.force_authenticate(user)
        poles = client.get(reverse("employees:poles-list")).json()
        self.assertTrue(poles)
        self.assertNotIn("director", poles[0])