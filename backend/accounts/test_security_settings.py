"""Tests of the IT page "Security settings" (MFA + password change), /api/auth/security-settings/."""
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import SecuritySettings, User

URL = reverse("accounts:security-settings")


class SecuritySettingsApiTests(APITestCase):
    def login_as(self, user):
        self.client.force_authenticate(user)

    def it(self):
        return User.objects.create_superuser("it.admin", must_change_password=False)

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_only_it(self):
        # Even Admin RH: security is IT's job.
        for role in (User.Role.HR_ADMIN, User.Role.HR, User.Role.MANAGER, User.Role.COLLABORATOR):
            with self.subTest(role=role):
                self.login_as(User.objects.create_user(f"user.{role.lower()}", role=role, must_change_password=False))
                self.assertEqual(self.client.get(URL).status_code, 403)
                self.assertEqual(self.client.patch(URL, {"mfa_enabled": True}, format="json").status_code, 403)
        self.assertFalse(SecuritySettings.load().mfa_enabled)

    def test_it_reads_the_settings(self):
        self.login_as(self.it())
        data = self.client.get(URL).json()
        self.assertFalse(data["mfa_enabled"])          # default values of the model
        self.assertTrue(data["password_change_hr"])
        self.assertNotIn("id", data)

    def test_it_turns_mfa_on_for_some_roles(self):
        self.login_as(self.it())
        response = self.client.patch(URL, {"mfa_enabled": True, "mfa_required_collaborator": True}, format="json")
        self.assertEqual(response.status_code, 200)
        settings = SecuritySettings.load()
        self.assertTrue(settings.mfa_enabled)
        self.assertTrue(settings.mfa_required_collaborator)
        self.assertTrue(settings.mfa_required_hr)        # not sent: unchanged
        self.assertEqual(SecuritySettings.objects.count(), 1)  # still one single row

    def test_it_turns_the_password_change_off_for_a_role(self):
        self.login_as(self.it())
        self.client.patch(URL, {"password_change_manager": False}, format="json")
        manager = User.objects.create_user("manager.x", role=User.Role.MANAGER)  # must_change_password=True
        self.assertFalse(manager.password_change_required())
