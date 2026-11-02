"""Tests de l'API des congés (step 6)."""
import datetime

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from employees.models import Department
from workflows.test_engine import EngineTestCase

from .models import LeaveRequest, LeaveSettings, LeaveType, PublicHoliday
from .services import request_leave

User = get_user_model()


def url(name):
    """Ex. url("mine-list"), url("mine-preview")."""
    return reverse(f"leaves:{name}")


def form(leave_type, start, end, **extra):
    """Ce que le formulaire envoie. Novembre 2026 : vendredi 6 = Marche Verte."""
    return {"leave_type": leave_type.pk, "start_date": f"2026-11-{start:02d}", "end_date": f"2026-11-{end:02d}", **extra}


class LeaveApiTests(EngineTestCase):
    def setUp(self):
        super().setUp()
        LeaveSettings.objects.update_or_create(pk=1, defaults={"counting_start": datetime.date(2026, 1, 1)})
        self.annual = LeaveType.objects.get(name="Congé annuel")
        self.client = APIClient()
        self.login(self.sara)

    def login(self, employee):
        employee.user.must_change_password = False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def test_anonymous_is_refused(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(url("mine-list")).status_code, 401)

    def test_lists_for_the_form(self):
        LeaveType.objects.filter(name="Congé sans solde").update(is_active=False)
        names = [item["name"] for item in self.client.get(url("type-list")).json()]
        self.assertIn("Congé annuel", names)
        self.assertNotIn("Congé sans solde", names)  # désactivé : plus proposé
        holidays = self.client.get(url("holiday-list"), {"year": 2027}).json()
        self.assertEqual(len(holidays), 11)
        self.assertTrue(all(item["date"].startswith("2027") for item in holidays))

    def test_preview_explains_the_count_and_the_balance_after(self):
        data = self.client.post(url("mine-preview"), form(self.annual, 5, 9)).json()
        self.assertEqual(data["days"], 2.5)  # jeudi 1 + férié 0 + samedi 0,5 + dimanche 0 + lundi 1
        self.assertEqual(data["detail"][1], {"date": "2026-11-06", "days": 0.0, "holiday": "Marche Verte"})
        self.assertEqual(data["balance_after"], data["balance"]["available"] - 2.5)
        self.assertIsNone(data["error"])
        self.assertFalse(LeaveRequest.objects.exists())  # un aperçu n'enregistre rien

    def test_preview_shows_the_rule_that_would_block(self):
        wedding = LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié")
        data = self.client.post(url("mine-preview"), form(wedding, 9, 13)).json()
        self.assertIn("4 jour(s) au maximum", data["error"])
        self.assertIsNone(data["balance_after"])  # pas pris sur le solde

    def test_send_a_leave_and_see_it_in_my_leaves(self):
        response = self.client.post(url("mine-list"), form(self.annual, 23, 27, reason="Vacances"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.json()["days"], response.json()["status"]), (5, "IN_PROGRESS"))
        mine = self.client.get(url("mine-list")).json()
        self.assertEqual([item["leave_type_label"] for item in mine], ["Congé annuel"])
        self.assertEqual(self.client.get(url("mine-balance")).json()["pending"], 5)
        # Youssef ne voit pas les congés de Sara dans SES congés.
        self.login(self.youssef)
        self.assertEqual(self.client.get(url("mine-list")).json(), [])

    def test_a_refused_rule_is_a_clear_400(self):
        self.client.post(url("mine-list"), form(self.annual, 23, 27))
        response = self.client.post(url("mine-list"), form(self.annual, 26, 30))
        self.assertEqual(response.status_code, 400)
        self.assertIn("déjà un congé sur ces dates", response.json()["detail"])
        bad = self.client.post(url("mine-list"), {"leave_type": self.annual.pk, "start_date": "pas une date"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("end_date", bad.json())  # le champ manquant

    def test_cancel_through_the_engine_frees_the_days(self):
        leave = self.client.post(url("mine-list"), form(self.annual, 23, 27)).json()
        response = self.client.post(reverse("workflows:request-cancel", args=[leave["request"]]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get(url("mine-list")).json()[0]["status"], "CANCELLED")
        self.assertEqual(self.client.get(url("mine-balance")).json()["pending"], 0)

    def test_an_account_without_a_fiche(self):
        it = User.objects.create_user("it.support", is_superuser=True, must_change_password=False)
        self.client.force_authenticate(it)
        self.assertEqual(self.client.get(url("mine-balance")).status_code, 404)
        self.assertEqual(self.client.get(url("mine-list")).json(), [])


class HrLeaveApiTests(EngineTestCase):
    """Step 8 : les absences (RH) et les deux listes du module (Admin RH)."""

    def setUp(self):
        super().setUp()
        LeaveSettings.objects.update_or_create(pk=1, defaults={"counting_start": datetime.date(2026, 1, 1)})
        self.annual = LeaveType.objects.get(name="Congé annuel")
        self.client = APIClient()
        # Salma travaille à Riaya (l'autre pôle) ; Sara à SBD.
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        self.salma = self.make_employee("salma.riaya", "AA100010", department=production, position=production.positions.first())
        request_leave(self.sara, self.annual, datetime.date(2026, 11, 23), datetime.date(2026, 11, 27))
        request_leave(self.salma, self.annual, datetime.date(2026, 11, 2), datetime.date(2026, 11, 3))
        cancelled = request_leave(self.sara, self.annual, datetime.date(2026, 11, 9), datetime.date(2026, 11, 9))
        cancelled.request.status = "CANCELLED"
        cancelled.request.save()

    def as_role(self, employee, role):
        employee.user.role, employee.user.must_change_password = role, False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def absences(self, **period):
        return self.client.get(url("absence-list"), {"date_from": "2026-11-01", "date_to": "2026-11-30", **period})

    def test_hr_sees_the_absences_of_their_pole_only(self):
        self.as_role(self.nadia, User.Role.HR)  # RH de SBD
        rows = self.absences().json()
        self.assertEqual([(row["employee"], row["days"], row["status"]) for row in rows],
                         [(f"{self.sara.first_name} {self.sara.last_name.title()}", 5, "IN_PROGRESS")])  # ni Riaya, ni l'annulé
        self.assertEqual(rows[0]["department"], "Ventes")

    def test_admin_rh_sees_both_poles_and_the_period_filters(self):
        self.as_role(self.nadia, User.Role.HR_ADMIN)
        self.assertEqual(len(self.absences().json()), 2)
        self.assertEqual(len(self.absences(date_from="2026-11-20").json()), 1)  # seulement Sara (23 -> 27)

    def test_absences_are_for_hr_only_with_a_valid_period(self):
        self.as_role(self.sara, User.Role.COLLABORATOR)
        self.assertEqual(self.absences().status_code, 403)
        self.as_role(self.nadia, User.Role.HR)
        self.assertEqual(self.absences(date_to="2026-02-30").status_code, 400)
        self.assertEqual(self.absences(date_to="2026-10-01").status_code, 400)  # la fin avant le début

    def test_admin_rh_manages_the_holidays_and_the_types(self):
        holidays = reverse("leaves:list-public-holidays-list")
        self.as_role(self.nadia, User.Role.HR)
        self.assertEqual(self.client.post(holidays, {"name": "Aïd Al Fitr", "date": "2027-03-10"}).status_code, 403)
        self.as_role(self.nadia, User.Role.HR_ADMIN)
        self.assertEqual(self.client.post(holidays, {"name": "Aïd Al Fitr", "date": "2027-03-10"}).status_code, 201)
        twice = self.client.post(holidays, {"name": "Autre", "date": "2027-03-10"})
        self.assertEqual(twice.json()["non_field_errors"], ["Il y a déjà un jour férié à cette date."])
        # Un type : décompté ou pas, le maximum légal ; jamais supprimé, seulement désactivé.
        wedding = LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié")
        response = self.client.patch(reverse("leaves:list-leave-types-detail", args=[wedding.pk]), {"max_days": "5", "is_active": False})
        self.assertEqual((response.status_code, response.json()["max_days"]), (200, "5.0"))
        self.assertEqual(self.client.delete(reverse("leaves:list-leave-types-detail", args=[wedding.pk])).status_code, 405)
