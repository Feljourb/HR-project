"""Tests de la configuration des circuits (step 1)."""
from django.core.exceptions import ValidationError
from django.test import TestCase

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
