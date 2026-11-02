"""Tests du module Congés. Step 1 : les deux listes et leurs valeurs de départ."""
import datetime

from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import LeaveType, PublicHoliday


class InitialValuesTests(TestCase):
    """La migration 0002 a rempli les listes (proposition standard, à valider par les RH)."""

    def test_annual_leave_is_the_only_type_taken_from_the_balance(self):
        self.assertEqual(list(LeaveType.objects.filter(deducts_balance=True).values_list("name", flat=True)), ["Congé annuel"])

    def test_exceptional_leaves_have_their_legal_maximum(self):
        self.assertEqual(LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié").max_days, 4)
        self.assertEqual(LeaveType.objects.get(name="Congé exceptionnel - Naissance").max_days, 3)
        self.assertIsNone(LeaveType.objects.get(name="Congé annuel").max_days)  # limité par le solde

    def test_fixed_public_holidays_of_this_year_and_the_next(self):
        self.assertEqual(PublicHoliday.objects.get(date=datetime.date(2026, 11, 6)).name, "Marche Verte")
        self.assertTrue(PublicHoliday.objects.filter(date=datetime.date(2027, 7, 30)).exists())  # Fête du Trône
        self.assertEqual(PublicHoliday.objects.filter(date__year=2026).count(), 11)


class ListRulesTests(TestCase):
    def errors_of(self, item):
        with self.assertRaises(ValidationError) as error:
            item.full_clean()
        return error.exception.message_dict

    def test_one_holiday_per_day_but_the_same_name_every_year(self):
        # Le même nom chaque année : permis (ce n'est pas le nom qui est unique, c'est la date).
        PublicHoliday(name="Aïd Al Fitr", date=datetime.date(2027, 3, 10)).full_clean()
        PublicHoliday.objects.create(name="Aïd Al Fitr", date=datetime.date(2027, 3, 10))
        PublicHoliday(name="Aïd Al Fitr", date=datetime.date(2028, 2, 27)).full_clean()
        # Deux jours fériés le même jour : refusé.
        errors = self.errors_of(PublicHoliday(name="Autre fête", date=datetime.date(2027, 3, 10)))
        self.assertEqual(errors["__all__"], ["Il y a déjà un jour férié à cette date."])

    def test_leave_type_names_are_unique_and_max_is_at_least_half_a_day(self):
        self.assertIn("__all__", self.errors_of(LeaveType(name="congé ANNUEL")))  # même nom, autres majuscules
        self.assertIn("max_days", self.errors_of(LeaveType(name="Congé test", max_days=0)))
