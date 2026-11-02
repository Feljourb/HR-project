"""Tests du module Congés. Step 1 : les deux listes et leurs valeurs de départ. Step 2 : le calcul des jours.
Step 3 : envoyer une demande de congé (les règles, puis le circuit)."""
import datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from employees.models import Employee
from workflows import engine
from workflows.models import Request, RequestStep, WorkflowStep
from workflows.test_engine import EngineTestCase

from .balance import acquired, add_months, balance
from .counting import count_days, day_values, days_label
from .models import LeaveRequest, LeaveSettings, LeaveType, PublicHoliday
from .services import request_leave


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
        # Samedi : son 0,5, c'est le matin.
        self.assertEqual(self.count(28, 30, starts_afternoon=True), 1)               # samedi après-midi 0 + dim 0 + lundi 1
        self.assertEqual(self.count(23, 28, ends_noon=True), Decimal("5.5"))         # finit samedi midi : le matin est pris

    def test_the_detail_explains_the_total(self):
        self.assertEqual(day_values(nov(6), nov(7)), [(nov(6), 0), (nov(7), Decimal("0.5"))])

    def test_end_before_start_is_refused(self):
        with self.assertRaises(ValueError):
            self.count(9, 2)

    def test_days_are_written_the_french_way(self):
        self.assertEqual(days_label(Decimal("4.0")), "4")
        self.assertEqual(days_label(Decimal("2.5")), "2,5")
        self.assertEqual(days_label(Decimal("10")), "10")


class RequestLeaveTests(EngineTestCase):
    """Sara (Ventes) demande un congé ; son N+1 est Youssef (voir EngineTestCase)."""

    def setUp(self):
        super().setUp()
        # Le calcul commence avant l'embauche de l'équipe (05/01/2026) : Sara a déjà gagné ses jours de 2026.
        LeaveSettings.objects.update_or_create(pk=1, defaults={"counting_start": datetime.date(2026, 1, 1)})
        self.annual = LeaveType.objects.get(name="Congé annuel")
        self.sick = LeaveType.objects.get(name="Congé maladie")
        self.wedding = LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié")  # 4 jours max

    def ask(self, start, end, leave_type=None, employee=None, **halves):
        return request_leave(employee or self.sara, leave_type or self.annual, nov(start), nov(end), **halves)

    def error_of(self, start, end, **kwargs):
        with self.assertRaises(ValidationError) as error:
            self.ask(start, end, **kwargs)
        return " ".join(error.exception.messages)

    # --- Le chemin normal -------------------------------------------------------------

    def test_a_leave_goes_into_the_circuit_with_its_days(self):
        leave = self.ask(27, 30)  # vendredi -> lundi
        self.assertEqual(leave.days, Decimal("2.5"))
        self.assertEqual(leave.request.title, "Congé annuel du 27/11/2026 au 30/11/2026 (2,5 j)")
        self.assertEqual(leave.request.status, Request.Status.IN_PROGRESS)
        first = leave.request.steps.first()
        self.assertEqual((first.approver, first.assignee), (WorkflowStep.Approver.MANAGER, self.youssef))
        self.assertEqual(self.sara.leaves.get(), leave)  # "mes congés"

    def test_the_days_are_a_photo_taken_when_sent(self):
        leave = self.ask(23, 27)
        PublicHoliday.objects.create(name="Fête ajoutée", date=nov(24))  # Admin RH ajoute un férié APRÈS
        leave.refresh_from_db()
        self.assertEqual(leave.days, 5)

    # --- Les règles -------------------------------------------------------------------

    def test_end_before_start(self):
        self.assertIn("La date de fin est avant la date de début.", self.error_of(27, 23))

    def test_no_day_to_take(self):
        self.assertIn("aucun jour", self.error_of(29, 29))  # un dimanche seul
        self.assertIn("aucun jour", self.error_of(6, 6))    # la Marche Verte seule

    def test_a_deactivated_type(self):
        LeaveType.objects.filter(pk=self.wedding.pk).update(is_active=False)
        self.wedding.refresh_from_db()
        self.assertIn("n'est plus proposé", self.error_of(23, 24, leave_type=self.wedding))

    def test_the_legal_maximum_of_the_type(self):
        self.ask(23, 26, leave_type=self.wedding)  # 4 jours : permis
        message = self.error_of(9, 13, leave_type=self.wedding)  # 5 jours
        self.assertIn("4 jour(s) au maximum, cette demande en compte 5", message)

    def test_two_leaves_on_the_same_days(self):
        self.ask(23, 27)
        self.assertIn("déjà un congé sur ces dates (du 23/11/2026 au 27/11/2026)", self.error_of(26, 30))
        self.ask(30, 30)  # le lundi d'après : pas de chevauchement

    def test_a_morning_and_an_afternoon_of_the_same_day(self):
        self.ask(23, 24, ends_noon=True)          # finit mardi à midi
        self.ask(24, 25, starts_afternoon=True)   # commence mardi après-midi : permis
        self.assertIn("déjà un congé", self.error_of(24, 24))  # le mardi entier : non

    def test_a_refused_or_cancelled_leave_frees_its_days(self):
        first = self.ask(23, 27)
        engine.cancel(first.request, self.sara.user)
        second = self.ask(23, 27)  # les mêmes jours : permis
        step = second.request.steps.get(status=RequestStep.Status.PENDING)
        engine.reject(step, self.youssef.user, "Période chargée")
        self.ask(23, 27)

    def test_another_employee_can_take_the_same_days(self):
        self.ask(23, 27)
        self.ask(23, 27, employee=self.youssef)

    def test_nothing_is_saved_when_a_rule_fails(self):
        self.error_of(29, 29)
        self.assertFalse(LeaveRequest.objects.exists())
        self.assertFalse(Request.objects.exists())  # pas de demande dans le circuit non plus

    # --- Règle 6 : le solde (step 4) --------------------------------------------------

    def test_the_balance_must_be_enough(self):
        # Embauchée il y a 2 mois tout juste : 2 x 1,5 = 3 jours gagnés.
        new = self.make_employee("nouvelle.recrue", "AA100009", hire_date=add_months(timezone.localdate(), -2))
        self.ask(23, 25, employee=new)  # lundi -> mercredi : 3 jours, permis
        # Les 3 jours sont "en attente" : il ne reste rien.
        self.assertIn("Solde insuffisant : 0 jour(s) disponible(s), cette demande en compte 1", self.error_of(26, 26, employee=new))
        # Un congé maladie ne touche pas au solde.
        self.ask(26, 26, employee=new, leave_type=self.sick)


class BalanceTests(EngineTestCase):
    """Le solde : acquis (mois complets x droit / 12, + ancienneté, au maximum 36) - pris - en attente."""

    def setUp(self):
        super().setUp()
        self.settings = LeaveSettings.load()
        self.settings.counting_start = datetime.date(2026, 1, 1)
        self.settings.save()
        self.annual = LeaveType.objects.get(name="Congé annuel")

    def gained(self, today, **fields):
        """Les jours gagnés par une fiche (pas enregistrée) à cette date."""
        return acquired(self.fiche("ZZ999999", **fields), today)

    def test_one_and_a_half_day_per_full_month(self):
        # Embauche le 05/01/2026 : le 04/11 = 9 mois complets ; le 05/11 = 10.
        self.assertEqual(self.gained(datetime.date(2026, 11, 4)), Decimal("13.5"))
        self.assertEqual(self.gained(datetime.date(2026, 11, 5)), 15)
        self.assertEqual(self.gained(datetime.date(2026, 1, 20)), 0)  # pas encore un mois complet

    def test_the_right_of_the_fiche_is_divided_by_12(self):
        # Un manager à 30 jours par an : 2,5 par mois.
        self.assertEqual(self.gained(datetime.date(2026, 3, 5), annual_leave_days=30), 5)

    def test_the_count_starts_at_the_setting_date_for_older_employees(self):
        self.settings.counting_start = datetime.date(2026, 11, 1)
        self.settings.save()
        # Embauché en 2020 : on compte depuis le 01/11/2026 seulement (2 mois au 01/01/2027),
        # et 6 ans d'ancienneté = 1 période de 5 ans : (18 + 1,5) / 12 = 1,625 par mois.
        self.assertEqual(self.gained(datetime.date(2027, 1, 1), hire_date=datetime.date(2020, 3, 10)), Decimal("3.25"))

    def test_seniority_starts_the_month_of_the_5_years(self):
        hire = datetime.date(2021, 3, 1)  # 5 ans le 01/03/2026
        self.assertEqual(self.gained(datetime.date(2026, 2, 1), hire_date=hire), Decimal("1.5"))     # janvier : 1,5
        self.assertEqual(self.gained(datetime.date(2026, 3, 1), hire_date=hire), Decimal("3.13"))    # + février : 1,625

    def test_at_most_36_days_a_year(self):
        # Droit 35 + 26 ans d'ancienneté (5 périodes = 7,5) = 42,5 -> plafonné à 36 : 3 par mois.
        old = {"hire_date": datetime.date(2000, 1, 1), "annual_leave_days": 35}
        self.assertEqual(self.gained(datetime.date(2026, 2, 1), **old), 3)

    def test_nothing_is_gained_after_the_departure(self):
        self.assertEqual(self.gained(datetime.date(2026, 11, 5), departure_date=datetime.date(2026, 3, 5)), 3)

    def test_months_with_31_days(self):
        self.assertEqual(add_months(datetime.date(2026, 1, 31), 1), datetime.date(2026, 2, 28))
        self.assertEqual(add_months(datetime.date(2026, 1, 31), 2), datetime.date(2026, 3, 31))  # pas le 28
        self.assertEqual(add_months(datetime.date(2026, 11, 15), 3), datetime.date(2027, 2, 15))

    def test_taken_pending_and_available(self):
        today = datetime.date(2026, 11, 5)  # Sara : 10 mois = 15 jours
        first = request_leave(self.sara, self.annual, nov(23), nov(27))     # 5 jours, en attente
        self.assertEqual(balance(self.sara, today), {"acquired": 15, "taken": 0, "pending": 5, "available": 10})
        engine.approve(first.request.steps.get(status=RequestStep.Status.PENDING), self.youssef.user)  # N+1 valide
        self.assertEqual(balance(self.sara, today), {"acquired": 15, "taken": 5, "pending": 0, "available": 10})
        # Annulé : les jours reviennent ; un type non décompté (mariage) : rien ne bouge.
        other = request_leave(self.sara, self.annual, nov(9), nov(10))
        engine.cancel(other.request, self.sara.user)
        request_leave(self.sara, LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié"), nov(2), nov(3))
        self.assertEqual(balance(self.sara, today)["available"], 10)


class ApprovedLeaveTests(EngineTestCase):
    """Step 5 : quand le circuit accepte un congé (@on_approved("LEAVE"))."""

    def setUp(self):
        super().setUp()
        LeaveSettings.objects.update_or_create(pk=1, defaults={"counting_start": datetime.date(2026, 1, 1)})
        self.annual = LeaveType.objects.get(name="Congé annuel")

    def pending_step(self, leave):
        return leave.request.steps.get(status=RequestStep.Status.PENDING)

    def test_the_module_is_registered_in_the_engine(self):
        self.assertIn("LEAVE", engine.HANDLERS)

    def test_an_approved_leave_is_taken_from_the_balance(self):
        leave = request_leave(self.sara, self.annual, nov(23), nov(27))
        engine.approve(self.pending_step(leave), self.youssef.user)  # N+1 valide, puis RH informée
        leave.request.refresh_from_db()
        self.assertEqual(leave.request.status, Request.Status.APPROVED)
        self.assertEqual(balance(self.sara)["taken"], 5)

    def test_approval_is_blocked_when_the_balance_went_down(self):
        leave = request_leave(self.sara, self.annual, nov(23), nov(27))
        # Entre-temps, le RH corrige le droit de la fiche à 0 : le solde ne suffit plus.
        Employee.objects.filter(pk=self.sara.pk).update(annual_leave_days=0)
        with self.assertRaises(ValidationError) as error:
            engine.approve(self.pending_step(leave), self.youssef.user)
        self.assertIn("Solde insuffisant", error.exception.messages[0])
        # Tout est annulé : la demande est toujours en cours, l'étape attend toujours Youssef...
        leave.request.refresh_from_db()
        self.assertEqual(leave.request.status, Request.Status.IN_PROGRESS)
        # ... qui peut la refuser.
        engine.reject(self.pending_step(leave), self.youssef.user, "Solde insuffisant")

    def test_a_demo_request_without_dates_is_approved_normally(self):
        request = engine.submit("LEAVE", self.sara, "Demande de démonstration")  # make seed-requests
        engine.approve(request.steps.get(status=RequestStep.Status.PENDING), self.youssef.user)
        request.refresh_from_db()
        self.assertEqual(request.status, Request.Status.APPROVED)
