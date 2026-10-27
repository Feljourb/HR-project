"""Tests de la cloche 🔔 (step G) : fin de la période d'essai."""
import datetime

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from . import services
from .models import Category, Department, Employee, Notification
from .notifications import one_month_before
from .tests import EmployeeTestCase

User = get_user_model()
URL = reverse("employees:notification-list")
TRIAL = Employee.Status.TRIAL


def in_days(days):
    return timezone.localdate() + datetime.timedelta(days=days)


class TrialEndNotificationTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.hr = self.ready("HR000001", role=User.Role.HR, first_name="Rh")  # RH de SBD

    def ready(self, cin, role=None, **fields):
        employee = services.create_with_account(self.fiche(cin, **fields), role=role)
        employee.user.must_change_password = False
        employee.user.save()
        return employee

    def on_trial(self, cin, days_left, **fields):
        """Un collaborateur en période d'essai qui se termine dans `days_left` jours."""
        return self.ready(cin, status=TRIAL, trial_end_date=in_days(days_left), **fields)

    def bell(self, employee=None):
        self.client.force_authenticate((employee or self.hr).user)
        return self.client.get(URL).json()

    def test_ten_days_before(self):
        self.on_trial("AB000001", 10, first_name="Karim")
        self.on_trial("AB000002", 11, first_name="Salim")  # trop tôt
        data = self.bell()
        self.assertEqual(data["unread"], 1)
        self.assertIn("Karim ALAMI", data["results"][0]["message"])
        self.assertIn("dans 10 jours", data["results"][0]["message"])

    def test_one_month_before_for_a_cadre(self):
        cadre = Category.objects.get(name="Cadre")
        self.on_trial("AB000001", 25, first_name="Karim", category=cadre)  # cadre : prévenu
        self.on_trial("AB000002", 25, first_name="Salim")                  # employé : pas encore
        self.assertEqual(self.bell()["unread"], 1)

    def test_one_month_before_handles_short_months(self):
        self.assertEqual(one_month_before(datetime.date(2026, 3, 31)), datetime.date(2026, 2, 28))
        self.assertEqual(one_month_before(datetime.date(2026, 1, 15)), datetime.date(2025, 12, 15))

    def test_still_there_after_the_end_date(self):
        self.on_trial("AB000001", 10, first_name="Karim")
        Employee.objects.filter(cin="AB000001").update(trial_end_date=in_days(-2))  # date passée
        message = self.bell()["results"][0]["message"]
        self.assertIn("s'est terminée", message)

    def test_who_is_notified(self):
        self.on_trial("AB000001", 5, first_name="Karim")  # SBD
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        riaya_hr = self.ready("HR000002", role=User.Role.HR, first_name="Rh2",
                              department=production, position=production.positions.first())
        admin = self.ready("HR000003", role=User.Role.HR_ADMIN, first_name="Admin")
        collab = self.ready("AB000009", first_name="Collab")

        self.assertEqual(self.bell()["unread"], 1)            # RH du pôle
        self.assertEqual(self.bell(admin)["unread"], 1)       # Admin RH
        self.assertEqual(self.bell(riaya_hr)["unread"], 0)    # RH de l'autre pôle
        self.assertEqual(self.bell(collab)["results"], [])    # collaborateur : rien

    def test_no_duplicates(self):
        self.on_trial("AB000001", 5, first_name="Karim")
        self.bell()
        self.bell()
        self.assertEqual(Notification.objects.filter(recipient=self.hr.user).count(), 1)

    def test_gone_when_the_status_changes(self):
        karim = self.on_trial("AB000001", 5, first_name="Karim")
        self.assertEqual(self.bell()["unread"], 1)
        karim.status = Employee.Status.ACTIVE  # embauche confirmée
        karim.save()
        self.assertEqual(self.bell()["results"], [])

    def test_read_and_read_all(self):
        self.on_trial("AB000001", 5, first_name="Karim")
        self.on_trial("AB000002", 6, first_name="Salim")
        first = self.bell()["results"][0]

        response = self.client.post(reverse("employees:notification-read", args=[first["id"]]))
        self.assertTrue(response.json()["read"])
        self.assertEqual(self.bell()["unread"], 1)

        self.client.post(reverse("employees:notification-read-all"))
        self.assertEqual(self.bell()["unread"], 0)

    def test_nobody_reads_the_notification_of_someone_else(self):
        self.on_trial("AB000001", 5, first_name="Karim")
        notification_id = self.bell()["results"][0]["id"]
        admin = self.ready("HR000003", role=User.Role.HR_ADMIN, first_name="Admin")
        self.client.force_authenticate(admin.user)
        self.assertEqual(self.client.post(reverse("employees:notification-read", args=[notification_id])).status_code, 404)
