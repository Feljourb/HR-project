"""Tests du module Notes de frais. Step 1 : les catégories, le barème par grade et leurs valeurs de départ."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from employees.models import Grade

from .models import ExpenseCategory, ExpenseScale


class InitialValuesTests(TestCase):
    def test_initial_categories(self):
        # La migration 0002 : 11 catégories, toutes avec justificatif.
        self.assertEqual(ExpenseCategory.objects.count(), 11)
        self.assertFalse(ExpenseCategory.objects.filter(receipt_required=False).exists())
        # Seules l'indemnité, le transport et l'hôtel suivent le barème.
        self.assertEqual(ExpenseCategory.objects.exclude(ceiling=ExpenseCategory.Ceiling.NONE).count(), 3)

    def test_the_scale_of_each_grade(self):
        self.assertEqual(ExpenseScale.objects.count(), 5)  # grades A -> E
        scale = ExpenseScale.objects.get(grade__name="Grade C — Cadre")
        self.assertEqual((scale.daily_allowance, scale.transport, scale.hotel), (450, 700, 700))

    def test_ceiling_of_a_category_for_a_grade(self):
        scale = ExpenseScale.objects.get(grade__name="Grade E — Employé")
        hotel = ExpenseCategory.objects.get(name="Hébergement (hôtel)")
        fuel = ExpenseCategory.objects.get(name="Carburant")
        self.assertEqual(scale.ceiling_for(hotel), Decimal("400"))
        self.assertIsNone(scale.ceiling_for(fuel))  # pas de plafond


class RulesTests(TestCase):
    def errors_of(self, item):
        with self.assertRaises(ValidationError) as error:
            item.full_clean()
        return error.exception.message_dict

    def test_category_names_are_unique(self):
        self.assertIn("__all__", self.errors_of(ExpenseCategory(name="CARBURANT")))  # même nom, autres majuscules

    def test_one_scale_per_grade_and_positive_amounts(self):
        grade = Grade.objects.get(name="Grade A — Direction")
        self.assertIn("grade", self.errors_of(ExpenseScale(grade=grade, daily_allowance=1, transport=1, hotel=1)))
        new_grade = Grade.objects.create(name="Grade F — Test")
        self.assertIn("hotel", self.errors_of(ExpenseScale(grade=new_grade, daily_allowance=1, transport=1, hotel=0)))
