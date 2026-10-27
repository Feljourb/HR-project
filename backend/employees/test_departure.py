"""Tests du statut "Sorti" (step E) : date de sortie obligatoire, compte bloqué tout de suite."""
import datetime

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.services import can_reset_password

from . import services
from .models import Employee
from .tests import EmployeeTestCase

User = get_user_model()
LEFT = Employee.Status.LEFT


class DepartureRulesTests(EmployeeTestCase):
    def errors_of(self, **fields):
        with self.assertRaises(ValidationError) as error:
            self.fiche("AB111111", **fields).full_clean(exclude=["user"])
        return error.exception.message_dict

    def test_left_needs_a_departure_date(self):
        self.assertIn("departure_date", self.errors_of(status=LEFT))
        self.fiche("AB111111", status=LEFT, departure_date=datetime.date(2026, 6, 30)).full_clean(exclude=["user"])

    def test_departure_is_not_before_hire(self):
        errors = self.errors_of(departure_date=datetime.date(2025, 12, 31))  # embauche : 05/01/2026
        self.assertEqual(errors["departure_date"], ["La date de sortie est avant la date d'embauche."])


class AccountBlockedTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.karim = self.make_employee("k.karim", "AB000001", first_name="Karim")
        self.user = self.karim.user
        self.user.must_change_password = False
        self.user.save()

    def leave(self, employee=None):
        employee = employee or self.karim
        employee.status = LEFT
        employee.departure_date = datetime.date(2026, 6, 30)
        employee.save()
        self.user.refresh_from_db()

    def logged_in_client(self):
        """Un navigateur déjà connecté : il a ses deux cookies, comme après le login."""
        client = APIClient()
        refresh = RefreshToken.for_user(self.user)
        client.cookies["access_token"] = str(refresh.access_token)
        client.cookies["refresh_token"] = str(refresh)
        return client

    def test_left_blocks_the_account(self):
        self.leave()
        self.assertFalse(self.user.is_active)

    def test_an_open_session_stops_immediately(self):
        client = self.logged_in_client()
        self.assertEqual(client.get(reverse("accounts:me")).status_code, 200)

        self.leave()
        # Même avec un access token encore valable (15 min), c'est fini tout de suite...
        self.assertEqual(client.get(reverse("accounts:me")).status_code, 401)
        # ... et le refresh token ne donne plus de nouveau token.
        self.assertEqual(client.post(reverse("accounts:refresh")).status_code, 401)

    def test_login_is_refused(self):
        self.user.set_password("Sbd-Test-2026!")
        self.user.save()
        self.leave()
        response = APIClient().post(reverse("accounts:login"), {"username": "k.karim", "password": "Sbd-Test-2026!"})
        self.assertEqual(response.status_code, 401)

    def test_back_to_active_unblocks(self):
        self.leave()
        self.karim.status = Employee.Status.ACTIVE
        self.karim.save()
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_other_changes_never_unblock_a_manual_block(self):
        """L'IT a bloqué le compte à la main : modifier le téléphone ne le débloque pas."""
        self.user.is_active = False
        self.user.save()
        self.karim.phone = "0622222222"
        self.karim.save()
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

    def test_no_password_reset_for_a_blocked_account(self):
        hr = services.create_with_account(self.fiche("HR000001", first_name="Rh"), role=User.Role.HR)
        hr.user.must_change_password = False
        hr.user.save()
        self.leave()
        self.assertFalse(can_reset_password(hr.user, self.user))

        client = APIClient()
        client.force_authenticate(hr.user)
        url = reverse("employees:employee-reset-password", args=[self.karim.pk])
        self.assertEqual(client.post(url).status_code, 403)

    def test_hr_marks_left_through_the_api(self):
        hr = services.create_with_account(self.fiche("HR000001", first_name="Rh"), role=User.Role.HR)
        hr.user.must_change_password = False
        hr.user.save()
        client = APIClient()
        client.force_authenticate(hr.user)
        url = reverse("employees:employee-detail", args=[self.karim.pk])

        response = client.patch(url, {"status": "LEFT"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("departure_date", response.json())

        response = client.patch(url, {"status": "LEFT", "departure_date": "2026-06-30"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
