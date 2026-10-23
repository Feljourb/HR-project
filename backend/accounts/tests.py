import time

import pyotp
from django.core.cache import cache
from django.test import override_settings
from django.urls import include, path, reverse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APITestCase
from rest_framework.views import APIView

from . import mfa
from .models import SecuritySettings, User
from .permissions import IsHR, IsHRAdmin, IsManager

PASSWORD = "Strong-Pass-2026!"


# --- Fake endpoints, only used by these tests -------------------------------

def make_view(*permissions):
    class FakeView(APIView):
        if permissions:
            permission_classes = list(permissions)

        def get(self, request):
            return Response({"ok": True})

    return FakeView.as_view()


urlpatterns = [
    path("api/auth/", include("accounts.urls")),
    path("test/default/", make_view()),  # no permission_classes -> settings default
    path("test/hr-admin/", make_view(IsHRAdmin)),
    path("test/hr/", make_view(IsHR)),
    path("test/manager/", make_view(IsManager)),
]


# --- Helpers ------------------------------------------------------------------

class AuthTestCase(APITestCase):
    def setUp(self):
        cache.clear()  # reset the attempt counters (throttling) between tests

    def create_user(self, username="ali.test", **extra):
        # A new account must change its password (model default). Most tests need an
        # account that already did; tests about a temporary password pass must_change_password=True.
        extra.setdefault("must_change_password", False)
        return User.objects.create_user(username, password=PASSWORD, **extra)

    def login(self, username="ali.test", password=PASSWORD):
        return self.client.post(
            reverse("accounts:login"),
            {"username": username, "password": password},
            format="json",
        )


# --- Endpoints ----------------------------------------------------------------

class LoginTests(AuthTestCase):
    def test_login_sets_httponly_cookies_and_returns_user_info(self):
        self.create_user(role=User.Role.HR)
        response = self.login()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {"username": "ali.test", "role": "HR", "must_change_password": False, "mfa_setup_required": False},
        )
        for name in ("access_token", "refresh_token"):
            self.assertTrue(response.cookies[name].value)
            self.assertTrue(response.cookies[name]["httponly"])
            self.assertEqual(response.cookies[name]["samesite"], "Lax")

    def test_login_with_wrong_password_fails_without_cookies(self):
        self.create_user()
        response = self.login(password="wrong")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn("access_token", response.cookies)

    def test_inactive_user_cannot_login(self):
        self.create_user(is_active=False)
        self.assertEqual(self.login().status_code, status.HTTP_401_UNAUTHORIZED)


class MeTests(AuthTestCase):
    def test_me_returns_current_user(self):
        self.create_user(role=User.Role.MANAGER)
        self.login()
        response = self.client.get(reverse("accounts:me"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {"username": "ali.test", "role": "MANAGER", "must_change_password": False, "mfa_setup_required": False},
        )

    def test_me_without_cookie_is_401(self):
        response = self.client.get(reverse("accounts:me"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_with_invalid_token_is_401(self):
        self.client.cookies["access_token"] = "fake"
        response = self.client.get(reverse("accounts:me"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class RefreshTests(AuthTestCase):
    def test_refresh_without_cookie_is_401(self):
        response = self.client.post(reverse("accounts:refresh"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_rotates_tokens_and_blacklists_the_old_one(self):
        self.create_user()
        old_refresh = self.login().cookies["refresh_token"].value

        response = self.client.post(reverse("accounts:refresh"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("access", response.data)  # tokens only in cookies
        self.assertNotEqual(response.cookies["refresh_token"].value, old_refresh)

        self.client.cookies["refresh_token"] = old_refresh
        response = self.client.post(reverse("accounts:refresh"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_works_even_with_expired_access_token(self):
        self.create_user()
        self.login()
        self.client.cookies["access_token"] = "expired-or-fake"

        response = self.client.post(reverse("accounts:refresh"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class LogoutTests(AuthTestCase):
    def test_logout_blacklists_refresh_token_and_deletes_cookies(self):
        self.create_user()
        old_refresh = self.login().cookies["refresh_token"].value

        response = self.client.post(reverse("accounts:logout"))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        for name in ("access_token", "refresh_token"):
            self.assertEqual(response.cookies[name].value, "")
            self.assertEqual(response.cookies[name]["max-age"], 0)

        self.client.cookies["refresh_token"] = old_refresh
        response = self.client.post(reverse("accounts:refresh"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_without_cookies_still_succeeds(self):
        response = self.client.post(reverse("accounts:logout"))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_logout_works_with_expired_access_token(self):
        self.create_user()
        self.login()
        self.client.cookies["access_token"] = "expired-or-fake"

        response = self.client.post(reverse("accounts:logout"))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)


class ChangePasswordTests(AuthTestCase):
    NEW_PASSWORD = "Another-Strong-2026!"

    def setUp(self):
        super().setUp()
        self.user = self.create_user(must_change_password=True)
        self.login()

    def change(self, current, new):
        return self.client.post(
            reverse("accounts:change-password"),
            {"current_password": current, "new_password": new},
            format="json",
        )

    def test_success_clears_flag_and_changes_password(self):
        response = self.change(PASSWORD, self.NEW_PASSWORD)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertFalse(self.user.must_change_password)
        self.assertTrue(self.user.check_password(self.NEW_PASSWORD))
        # The new cookies keep this session logged in.
        self.assertEqual(self.client.get(reverse("accounts:me")).status_code, 200)

    def test_success_logs_out_other_sessions(self):
        other_device_refresh = self.client.cookies["refresh_token"].value
        self.change(PASSWORD, self.NEW_PASSWORD)

        self.client.cookies["refresh_token"] = other_device_refresh
        response = self.client.post(reverse("accounts:refresh"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_wrong_current_password_is_rejected(self):
        response = self.change("wrong", self.NEW_PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("current_password", response.data)

    def test_weak_password_is_rejected_by_django_validators(self):
        response = self.change(PASSWORD, "12345678")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", response.data)

    def test_same_password_is_rejected(self):
        response = self.change(PASSWORD, PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_cannot_change_password(self):
        self.client.cookies.clear()
        response = self.change(PASSWORD, self.NEW_PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


# --- Permissions --------------------------------------------------------------

@override_settings(ROOT_URLCONF="accounts.tests")
class MustChangePasswordTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.create_user(must_change_password=True)
        self.login()

    def test_blocked_from_normal_endpoints(self):
        response = self.client.get("/test/default/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["detail"].code, "password_change_required")

    def test_allowed_endpoints_still_work(self):
        self.assertEqual(self.client.get(reverse("accounts:me")).status_code, 200)
        self.assertEqual(self.client.post(reverse("accounts:logout")).status_code, 204)

    def test_unblocked_after_changing_password(self):
        self.client.post(
            reverse("accounts:change-password"),
            {"current_password": PASSWORD, "new_password": "Another-Strong-2026!"},
            format="json",
        )
        self.assertEqual(self.client.get("/test/default/").status_code, 200)


@override_settings(ROOT_URLCONF="accounts.tests")
class RolePermissionTests(AuthTestCase):
    # Expected status per role on each fake endpoint.
    EXPECTED = {
        User.Role.COLLABORATOR: {"hr-admin": 403, "hr": 403, "manager": 403},
        User.Role.MANAGER: {"hr-admin": 403, "hr": 403, "manager": 200},
        User.Role.HR: {"hr-admin": 403, "hr": 200, "manager": 403},
        User.Role.HR_ADMIN: {"hr-admin": 200, "hr": 200, "manager": 403},
    }

    def test_each_role_gets_the_right_access(self):
        for role, expected in self.EXPECTED.items():
            self.client.force_authenticate(self.create_user(f"user.{role.lower()}", role=role))
            for endpoint, code in expected.items():
                with self.subTest(role=role, endpoint=endpoint):
                    self.assertEqual(self.client.get(f"/test/{endpoint}/").status_code, code)

    def test_superuser_has_access_to_everything(self):
        admin = User.objects.create_superuser("it.admin", password=PASSWORD)
        self.client.force_authenticate(admin)
        for endpoint in ("default", "hr-admin", "hr", "manager"):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.get(f"/test/{endpoint}/").status_code, 200)

    def test_role_endpoints_still_require_password_change(self):
        hr = self.create_user(role=User.Role.HR, must_change_password=True)
        self.client.force_authenticate(hr)
        self.assertEqual(self.client.get("/test/hr/").status_code, 403)

    def test_anonymous_is_401_on_role_endpoints(self):
        self.assertEqual(self.client.get("/test/hr/").status_code, 401)


@override_settings(ROOT_URLCONF="accounts.tests")
class PasswordChangePolicyTests(AuthTestCase):
    """IT decides in Réglages de sécurité who must change a temporary password."""

    def setUp(self):
        super().setUp()
        SecuritySettings.load()  # the row with its defaults

    def login_flagged(self, role):
        """A user with a temporary password logs in. Returns the must_change_password sent to the frontend."""
        self.create_user(f"user.{role.lower()}", role=role, must_change_password=True)
        return self.login(f"user.{role.lower()}").data["must_change_password"]

    def test_new_account_must_change_password_at_first_login(self):
        User.objects.create_user("new.user", password=PASSWORD)  # no flag given: model default
        self.assertTrue(self.login("new.user").data["must_change_password"])
        self.assertEqual(self.client.get("/test/default/").status_code, 403)

    def test_required_by_default_for_every_role(self):
        for role in User.Role:
            with self.subTest(role=role):
                self.assertTrue(self.login_flagged(role))
                self.assertTrue(self.client.get(reverse("accounts:me")).data["must_change_password"])
                self.assertEqual(self.client.get("/test/default/").status_code, 403)

    def test_rule_turned_off_for_one_role(self):
        SecuritySettings.objects.update(password_change_collaborator=False)

        self.assertFalse(self.login_flagged(User.Role.COLLABORATOR))
        self.assertEqual(self.client.get("/test/default/").status_code, 200)

        self.assertTrue(self.login_flagged(User.Role.HR))  # other roles still blocked
        self.assertEqual(self.client.get("/test/default/").status_code, 403)

    def test_rule_turned_off_for_everyone(self):
        SecuritySettings.objects.update(password_change_enabled=False)
        self.assertFalse(self.login_flagged(User.Role.HR_ADMIN))
        self.assertEqual(self.client.get("/test/default/").status_code, 200)

    def test_superuser_not_required_by_default(self):
        User.objects.create_superuser("it.admin", password=PASSWORD, must_change_password=True)
        self.assertFalse(self.login("it.admin").data["must_change_password"])
        self.assertEqual(self.client.get("/test/default/").status_code, 200)

        SecuritySettings.objects.update(password_change_superuser=True)
        self.assertEqual(self.client.get("/test/default/").status_code, 403)


# --- MFA ----------------------------------------------------------------------

@override_settings(ROOT_URLCONF="accounts.tests")
class MfaTestCase(AuthTestCase):
    """IT turned MFA on; self.user is HR, so MFA is required for them."""

    def setUp(self):
        super().setUp()
        SecuritySettings.objects.update_or_create(pk=1, defaults={"mfa_enabled": True})
        self.user = self.create_user(role=User.Role.HR)

    def code(self, offset=0):
        """The code the phone shows now (+offset seconds). The activation code can't be
        reused, so later logins use code(30): the next one, still accepted."""
        secret = mfa.decrypt(User.objects.get(pk=self.user.pk).mfa_secret)
        return pyotp.TOTP(secret).at(time.time() + offset)

    def activate(self):
        """Scan the QR code and confirm the first code. Returns the recovery codes."""
        self.login()
        self.client.post(reverse("accounts:mfa-setup"))
        response = self.client.post(reverse("accounts:mfa-confirm"), {"code": self.code()}, format="json")
        self.client.post(reverse("accounts:logout"))
        return response.data["recovery_codes"]

    def login_with_code(self, code, **extra):
        return self.client.post(reverse("accounts:login-mfa"), {"code": code, **extra}, format="json")


class MfaPolicyTests(MfaTestCase):
    def test_mfa_off_means_normal_login(self):
        SecuritySettings.objects.update(mfa_enabled=False)
        response = self.login()
        self.assertFalse(response.data["mfa_setup_required"])
        self.assertIn("access_token", response.cookies)

    def test_collaborator_is_not_required(self):
        self.create_user("collab.test", role=User.Role.COLLABORATOR)
        response = self.login("collab.test")
        self.assertFalse(response.data["mfa_setup_required"])

    def test_it_superuser_is_required(self):
        User.objects.create_superuser("it.admin", password=PASSWORD)
        self.assertTrue(self.login("it.admin").data["mfa_setup_required"])

    def test_required_user_is_blocked_until_activation(self):
        self.assertTrue(self.login().data["mfa_setup_required"])
        response = self.client.get("/test/default/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["detail"].code, "mfa_setup_required")
        self.assertEqual(self.client.get(reverse("accounts:me")).status_code, 200)


class MfaActivationTests(MfaTestCase):
    def setUp(self):
        super().setUp()
        self.login()

    def test_setup_gives_a_qr_code_and_keeps_the_same_secret_on_reload(self):
        first = self.client.post(reverse("accounts:mfa-setup")).data
        second = self.client.post(reverse("accounts:mfa-setup")).data
        self.assertTrue(first["qr_code"].startswith("data:image/svg+xml;base64,"))
        self.assertEqual(first["secret"], second["secret"])

    def test_wrong_first_code_is_rejected(self):
        self.client.post(reverse("accounts:mfa-setup"))
        response = self.client.post(reverse("accounts:mfa-confirm"), {"code": "000000"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_activation_gives_10_recovery_codes_and_unblocks(self):
        self.client.post(reverse("accounts:mfa-setup"))
        response = self.client.post(reverse("accounts:mfa-confirm"), {"code": self.code()}, format="json")
        self.assertEqual(len(response.data["recovery_codes"]), 10)
        self.assertEqual(self.client.get("/test/default/").status_code, 200)

    def test_secret_is_encrypted_in_the_database(self):
        secret = self.client.post(reverse("accounts:mfa-setup")).data["secret"]
        self.assertNotIn(secret, User.objects.get(pk=self.user.pk).mfa_secret)


class MfaLoginTests(MfaTestCase):
    def setUp(self):
        super().setUp()
        self.recovery_codes = self.activate()

    def test_password_alone_gives_no_session(self):
        response = self.login()
        self.assertEqual(response.data, {"mfa_required": True})
        self.assertNotIn("access_token", response.cookies)
        self.assertEqual(self.client.get(reverse("accounts:me")).status_code, 401)

    def test_right_code_opens_the_session(self):
        self.login()
        response = self.login_with_code(self.code(30))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(reverse("accounts:me")).status_code, 200)

    def test_wrong_code_is_rejected(self):
        self.login()
        self.assertEqual(self.login_with_code("000000").status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_code_works_only_once(self):
        code = self.code(30)
        self.login()
        self.assertEqual(self.login_with_code(code).status_code, 200)
        self.login()
        self.assertEqual(self.login_with_code(code).status_code, 400)

    def test_recovery_code_works_only_once(self):
        self.login()
        self.assertEqual(self.login_with_code(self.recovery_codes[0]).status_code, 200)
        self.login()
        self.assertEqual(self.login_with_code(self.recovery_codes[0]).status_code, 400)

    def test_code_without_the_password_step_is_refused(self):
        self.assertEqual(self.login_with_code(self.code(30)).status_code, 401)

    def test_trusted_device_skips_the_code(self):
        self.login()
        self.login_with_code(self.code(30), remember=True)
        self.client.post(reverse("accounts:logout"))
        response = self.login()
        self.assertNotIn("mfa_required", response.data)
        self.assertIn("access_token", response.cookies)

    def test_it_reset_closes_sessions_and_forces_a_new_activation(self):
        self.login()
        self.login_with_code(self.code(30), remember=True)
        mfa.reset(User.objects.get(pk=self.user.pk))

        self.assertEqual(self.client.post(reverse("accounts:refresh")).status_code, 401)
        response = self.login()  # the trusted device no longer counts
        self.assertTrue(response.data["mfa_setup_required"])

    def test_it_turning_mfa_off_skips_the_code(self):
        SecuritySettings.objects.update(mfa_enabled=False)
        self.assertIn("access_token", self.login().cookies)

    def test_too_many_codes_are_throttled(self):
        cache.clear()
        self.login()
        for _ in range(5):
            self.login_with_code("000000")
        self.assertEqual(self.login_with_code(self.code(30)).status_code, status.HTTP_429_TOO_MANY_REQUESTS)
