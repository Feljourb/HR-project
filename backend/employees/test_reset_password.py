"""Tests de la réinitialisation du mot de passe (mot de passe oublié)."""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.services import ALPHABET, generate_temporary_password, reset_password

from . import services
from .models import Department
from .tests import EmployeeTestCase

User = get_user_model()
OLD_PASSWORD = "Ancien-Mot-2026!"


def reset_url(employee):
    return reverse("employees:employee-reset-password", args=[employee.pk])


class ResetPasswordTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()  # remet à zéro le compteur de tentatives de login (throttling)
        self.client = APIClient()
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        # Des collaborateurs SBD (le pôle du RH) et un de Riaya.
        self.collab = self.saved("AB000001", first_name="Karim")
        self.other_hr = self.saved("AB000002", first_name="Nadia", role=User.Role.HR)
        self.riaya = self.saved("AB000003", first_name="Salma", department=production,
                                position=production.positions.get(name="Opérateur de production"))

    def saved(self, cin, role=None, **fields):
        """Un dossier + son compte, avec un mot de passe connu et déjà changé."""
        employee = services.create_with_account(self.fiche(cin, **fields), role=role)
        employee.user.set_password(OLD_PASSWORD)
        employee.user.must_change_password = False
        employee.user.save()
        return employee

    def login_as(self, role, superuser=False):
        """Connecte un RH SBD (avec dossier), un Admin RH ou l'IT."""
        if role == User.Role.HR:
            user = self.saved("HR000001", first_name="Rh", role=role).user
        else:
            user = User.objects.create_user(f"user.{role.lower()}", role=role, is_superuser=superuser,
                                            must_change_password=False)
        self.client.force_authenticate(user)
        return user

    # --- Le service ------------------------------------------------------------

    def test_temporary_password_is_random_and_readable(self):
        password = generate_temporary_password()
        self.assertRegex(password, r"^.{4}-.{4}-.{4}$")
        self.assertTrue(all(char in ALPHABET for char in password.replace("-", "")))  # pas de 0/O, 1/l/I
        self.assertNotEqual(password, generate_temporary_password())

    def test_reset_changes_password_forces_change_and_closes_sessions(self):
        user = self.collab.user
        # Le collaborateur est connecté sur un appareil (il a un refresh token).
        login = self.client.post(reverse("accounts:login"), {"username": user.username, "password": OLD_PASSWORD})
        old_refresh = login.cookies["refresh_token"].value

        password = reset_password(user)
        user.refresh_from_db()
        self.assertTrue(user.check_password(password))
        self.assertFalse(user.check_password(OLD_PASSWORD))
        self.assertNotEqual(password, "AB000001")  # pas le CIN
        self.assertTrue(user.must_change_password)

        self.client.cookies["refresh_token"] = old_refresh  # l'ancienne session est fermée
        self.assertEqual(self.client.post(reverse("accounts:refresh")).status_code, 401)

    def test_user_signs_in_with_the_temporary_password_then_must_change_it(self):
        password = reset_password(self.collab.user)
        response = self.client.post(reverse("accounts:login"), {"username": self.collab.user.username, "password": password})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["must_change_password"])

    # --- L'API : qui peut réinitialiser qui --------------------------------------

    def test_hr_resets_a_collaborator_of_their_pole(self):
        self.login_as(User.Role.HR)
        response = self.client.post(reset_url(self.collab))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response.json()["username"], self.collab.user.username)
        self.collab.user.refresh_from_db()
        self.assertTrue(self.collab.user.check_password(response.json()["temporary_password"]))

    def test_hr_cannot_reach_the_other_pole(self):
        self.login_as(User.Role.HR)
        self.assertEqual(self.client.post(reset_url(self.riaya)).status_code, 404)

    def test_hr_cannot_reset_another_hr(self):
        self.login_as(User.Role.HR)
        self.assertEqual(self.client.post(reset_url(self.other_hr)).status_code, 403)
        self.other_hr.user.refresh_from_db()
        self.assertTrue(self.other_hr.user.check_password(OLD_PASSWORD))  # rien n'a changé

    def test_hr_admin_resets_an_hr(self):
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.post(reset_url(self.other_hr)).status_code, 200)

    def test_only_it_resets_an_it_account(self):
        it_employee = self.saved("IT000001", first_name="It")
        it_employee.user.is_superuser = True
        it_employee.user.save()

        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.post(reset_url(it_employee)).status_code, 403)
        self.login_as(User.Role.COLLABORATOR, superuser=True)  # l'IT
        self.assertEqual(self.client.post(reset_url(it_employee)).status_code, 200)

    def test_collaborator_cannot_reset(self):
        self.client.force_authenticate(self.collab.user)
        self.assertEqual(self.client.post(reset_url(self.other_hr)).status_code, 403)

    def test_fiche_tells_the_frontend_when_to_show_the_button(self):
        self.login_as(User.Role.HR)

        def fiche_of(employee):
            return self.client.get(reverse("employees:employee-detail", args=[employee.pk])).json()

        self.assertTrue(fiche_of(self.collab)["can_reset_password"])
        self.assertFalse(fiche_of(self.other_hr)["can_reset_password"])

    # --- L'action dans l'admin Django (IT) ---------------------------------------

    def test_admin_action_for_it(self):
        it = User.objects.create_superuser("it.admin", password="Strong-Pass-2026!")
        self.client.force_login(it)  # l'admin utilise la session Django, pas les cookies JWT
        response = self.client.post(reverse("admin:accounts_user_changelist"), {
            "action": "reset_password", "_selected_action": [self.collab.user.pk],
        }, follow=True)

        self.collab.user.refresh_from_db()
        self.assertTrue(self.collab.user.must_change_password)
        self.assertFalse(self.collab.user.check_password(OLD_PASSWORD))
        self.assertContains(response, "mot de passe temporaire")
