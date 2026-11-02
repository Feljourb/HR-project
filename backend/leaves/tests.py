"""Tests du module Congés. Step 1 : les deux listes et leurs valeurs de départ. Step 2 : le calcul des jours."""
import datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from .counting import count_days, day_values
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


def nov(day):
    """Novembre 2026 : lundi 2, vendredi 6 = Marche Verte (férié), lundi 9, mercredi 18 = Indépendance (férié)."""
    return datetime.date(2026, 11, day)


class CountingTests(TestCase):
    def count(self, start, end, **halves):
        return count_days(nov(start), nov(end), **halves)

    def test_weekdays_count_one_day(self):
        self.assertEqual(self.count(23, 27), 5)  # lundi -> vendredi, sans férié

    def test_saturday_is_half_a_day_and_sunday_nothing(self):
        self.assertEqual(self.count(27, 30), Decimal("2.5"))  # vendredi 1 + samedi 0,5 + dimanche 0 + lundi 1
        self.assertEqual(self.count(23, 29), Decimal("5.5"))  # une semaine entière
        self.assertEqual(self.count(29, 29), 0)               # un dimanche seul

    def test_public_holidays_count_nothing(self):
        self.assertEqual(self.count(2, 6), 4)                 # le vendredi 6 est la Marche Verte
        self.assertEqual(self.count(2, 9), Decimal("5.5"))    # 4 + férié 0 + samedi 0,5 + dimanche 0 + lundi 1

    def test_a_deactivated_holiday_is_a_normal_day(self):
        PublicHoliday.objects.filter(date=nov(6)).update(is_active=False)
        self.assertEqual(self.count(2, 6), 5)

    def test_half_days_at_the_start_or_the_end(self):
        self.assertEqual(self.count(23, 25, starts_afternoon=True), Decimal("2.5"))  # lundi après-midi -> mercredi
        self.assertEqual(self.count(23, 25, ends_noon=True), Decimal("2.5"))         # lundi -> mercredi midi
        self.assertEqual(self.count(23, 25, starts_afternoon=True, ends_noon=True), 2)
        self.assertEqual(self.count(23, 23, ends_noon=True), Decimal("0.5"))          # une matinée
        # Un samedi ou un férié garde son prix : la demi-journée ne change qu'un jour de travail.
        self.assertEqual(self.count(28, 30, starts_afternoon=True), Decimal("1.5"))  # samedi 0,5 + dim 0 + lundi 1

    def test_the_detail_explains_the_total(self):
        self.assertEqual(day_values(nov(6), nov(7)), [(nov(6), 0), (nov(7), Decimal("0.5"))])

    def test_end_before_start_is_refused(self):
        with self.assertRaises(ValueError):
            self.count(9, 2)
