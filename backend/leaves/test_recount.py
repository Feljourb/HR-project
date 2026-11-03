"""Recalcul des congés quand un jour férié change (recount.py, décision du 2026-11-03).
Novembre 2026 : vendredi 6 = Marche Verte, mercredi 18 = Indépendance. "Aujourd'hui" = 02/11/2026."""
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from employees.models import Employee, Notification
from employees.notifications import message
from workflows import engine
from workflows.models import Request
from workflows.test_engine import EngineTestCase

from .models import LeaveType, PublicHoliday
from .recount import holiday_changed
from .services import request_leave
from .tests import frozen_localdate, nov

User = get_user_model()
RECOUNTED = Notification.Kind.RECOUNTED


@mock.patch("django.utils.timezone.localdate", frozen_localdate)
class RecountTests(EngineTestCase):
    """Sara (Ventes) a des congés ; son N+1 est Youssef ; Nadia et Hind sont RH de SBD."""

    def setUp(self):
        super().setUp()
        self.annual = LeaveType.objects.get(name="Congé annuel")
        self.wedding = LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié")  # 4 jours max

    def ask(self, start, end, leave_type=None):
        return request_leave(self.sara, leave_type or self.annual, nov(start), nov(end))

    def approve(self, leave):
        engine.approve(leave.request.steps.get(status="PENDING"), self.youssef.user)

    def add_holiday(self, day, name="Fête ajoutée"):
        return holiday_changed(PublicHoliday.objects.create(name=name, date=nov(day)), None)

    def change(self, holiday, **fields):
        """Comme Admin RH sur la page Reference lists : l'état AVANT, le changement, puis le recalcul."""
        before = (holiday.date, holiday.is_active)
        for name, value in fields.items():
            setattr(holiday, name, value)
        holiday.save()
        return holiday_changed(holiday, before)

    def bells(self, employee):
        return Notification.objects.filter(recipient=employee.user, kind=RECOUNTED)

    # --- Les cas simples -------------------------------------------------------------

    def test_a_holiday_added_inside_a_leave_gives_a_day_back(self):
        leave = self.ask(23, 27)  # lundi -> vendredi : 5 jours
        self.add_holiday(24)
        leave.refresh_from_db()
        self.assertEqual(leave.days, 4)
        self.assertEqual(leave.request.title, "Congé annuel du 23/11/2026 au 27/11/2026 (4 j)")
        recount = leave.recounts.get()
        self.assertEqual((recount.old_days, recount.new_days, recount.reason, recount.warning),
                         (5, 4, "Jour férié ajouté : Fête ajoutée (24/11/2026)", ""))
        # La cloche : Sara seulement (rien à vérifier pour les RH).
        self.assertEqual(message(self.bells(self.sara).get()),
                         "Votre congé a été recalculé : 5 -> 4 j (Jour férié ajouté : Fête ajoutée (24/11/2026)).")
        self.assertFalse(self.bells(self.nadia).exists())

    def test_a_holiday_removed_from_an_approved_leave_costs_a_day(self):
        leave = self.ask(2, 6)  # 4 jours : le vendredi 6 est la Marche Verte
        self.approve(leave)
        self.change(PublicHoliday.objects.get(date=nov(6)), is_active=False)
        leave.refresh_from_db()
        self.assertEqual((leave.days, leave.request.status), (5, Request.Status.APPROVED))  # jamais annulé
        self.assertEqual(leave.recounts.get().reason, "Jour férié désactivé : Marche Verte (06/11/2026)")

    def test_a_holiday_moved_out_of_a_leave_and_into_another(self):
        first, second = self.ask(2, 6), self.ask(9, 13)  # 4 j (Marche Verte le 6) et 5 j
        self.change(PublicHoliday.objects.get(date=nov(6)), date=nov(10))
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.days, second.days), (5, 4))  # l'ancienne ET la nouvelle date sont recomptées
        self.assertEqual(second.recounts.get().reason, "Marche Verte déplacé : 06/11/2026 -> 10/11/2026")

    def test_moved_inside_the_same_leave_or_renamed_changes_nothing(self):
        leave = self.ask(2, 13)
        holiday = PublicHoliday.objects.get(date=nov(6))
        self.assertEqual(self.change(holiday, name="Marche Verte (51e)"), [])
        self.assertEqual(self.change(holiday, date=nov(5)), [])  # du vendredi 6 au jeudi 5 : même total
        leave.refresh_from_db()
        self.assertFalse(leave.recounts.exists())

    def test_a_saturday_counts_half_a_day(self):
        leave = self.ask(23, 28)  # lundi -> samedi : 5,5 jours
        self.add_holiday(28)
        leave.refresh_from_db()
        self.assertEqual(leave.days, 5)  # le samedi valait 0,5

    def test_refused_and_cancelled_leaves_are_not_touched(self):
        refused, cancelled = self.ask(23, 24), self.ask(26, 27)
        engine.reject(refused.request.steps.get(status="PENDING"), self.youssef.user, "Période chargée")
        engine.cancel(cancelled.request, self.sara.user)
        self.add_holiday(24)
        self.add_holiday(26, name="Autre fête")
        for leave in (refused, cancelled):
            leave.refresh_from_db()
            self.assertEqual(leave.days, 2)
            self.assertFalse(leave.recounts.exists())

    # --- Les cas à vérifier par les RH (jamais annulés tout seuls) -------------------

    def test_a_leave_with_no_day_left_is_kept(self):
        leave = self.ask(10, 10)  # un mardi
        self.add_holiday(10)
        leave.refresh_from_db()
        self.assertEqual((leave.days, leave.request.status), (0, Request.Status.IN_PROGRESS))
        self.assertEqual(leave.recounts.get().warning, "Ce congé ne compte plus aucun jour.")
        self.assertTrue(self.bells(self.nadia).exists())  # les RH du pôle sont prévenus

    def test_the_legal_maximum_is_passed(self):
        leave = self.ask(5, 10, leave_type=self.wedding)  # jeudi 1 + férié 0 + samedi 0,5 + dim 0 + lundi 1 + mardi 1 = 3,5
        self.change(PublicHoliday.objects.get(date=nov(6)), is_active=False)
        leave.refresh_from_db()
        self.assertEqual(leave.days, Decimal("4.5"))
        self.assertIn("Dépasse le maximum", leave.recounts.get().warning)
        hr_bell = self.bells(self.hind).get()
        self.assertIn("À vérifier : Dépasse le maximum", message(hr_bell))

    def test_a_negative_balance_is_allowed_and_hr_are_told(self):
        leave = self.ask(2, 6)
        self.approve(leave)
        # Le droit annuel baisse à 0 après l'acceptation : il ne reste rien, le jour en plus rend le solde négatif.
        Employee.objects.filter(pk=self.sara.pk).update(annual_leave_days=0)
        self.change(PublicHoliday.objects.get(date=nov(6)), is_active=False)
        warning = leave.recounts.get().warning
        self.assertTrue(warning.startswith("Solde négatif : -"), warning)
        self.assertTrue(self.bells(self.nadia).exists())

    # --- Depuis la page Reference lists (Admin RH) ------------------------------------

    def test_the_lists_page_recounts_and_keeps_who_changed(self):
        leave = self.ask(23, 27)
        self.nadia.user.role, self.nadia.user.must_change_password = User.Role.HR_ADMIN, False
        self.nadia.user.save()
        client = APIClient()
        client.force_authenticate(self.nadia.user)
        # En JSON, comme la page (un formulaire multipart lirait "is_active" absent comme False).
        response = client.post(reverse("leaves:list-public-holidays-list"), {"name": "Fête ajoutée", "date": "2026-11-25"},
                               format="json")
        self.assertEqual(response.status_code, 201)
        recount = leave.recounts.get()
        self.assertEqual((recount.new_days, recount.changed_by), (4, self.nadia.user))
        # "Mes congés" montre le recalcul.
        client.force_authenticate(self.sara.user)
        self.sara.user.must_change_password = False
        self.sara.user.save()
        mine = client.get(reverse("leaves:mine-list")).json()
        self.assertEqual(mine[0]["recounts"][0]["old_days"], 5)
