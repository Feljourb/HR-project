"""Tests du tableau des circuits (step 1)."""
from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import Workflow, WorkflowStep

Approver = WorkflowStep.Approver


class WorkflowModelTests(TestCase):
    def setUp(self):
        self.leave = Workflow.objects.create(name="Congé annuel")

    def add(self, order, approver, workflow=None):
        """Ajoute une étape en passant par les règles du modèle (comme un formulaire)."""
        step = WorkflowStep(workflow=workflow or self.leave, order=order, approver=approver)
        step.full_clean()
        step.save()
        return step

    def test_steps_come_in_order(self):
        self.add(2, Approver.HR)
        self.add(1, Approver.MANAGER)
        self.assertEqual([step.approver for step in self.leave.steps.all()], [Approver.MANAGER, Approver.HR])

    def test_two_steps_at_the_same_position_are_refused(self):
        self.add(1, Approver.MANAGER)
        with self.assertRaisesMessage(ValidationError, "Il y a déjà une étape à cette position."):
            self.add(1, Approver.HR)

    def test_the_same_approver_twice_is_refused(self):
        self.add(1, Approver.MANAGER)
        with self.assertRaisesMessage(ValidationError, "Ce valideur est déjà dans le circuit."):
            self.add(2, Approver.MANAGER)

    def test_order_starts_at_one(self):
        with self.assertRaises(ValidationError):
            self.add(0, Approver.HR)

    def test_another_workflow_has_its_own_steps(self):
        """La position 1 et le N+1 existent aussi dans un autre circuit : pas de conflit."""
        self.add(1, Approver.MANAGER)
        expenses = Workflow.objects.create(name="Note de frais")
        self.add(1, Approver.MANAGER, workflow=expenses)
        self.assertEqual(expenses.steps.count(), 1)

    def test_workflow_names_are_unique_ignoring_case(self):
        with self.assertRaisesMessage(ValidationError, "Cette valeur existe déjà."):
            Workflow(name="congé annuel").full_clean()
