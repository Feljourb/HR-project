from django.test import override_settings
from django.urls import include, path, reverse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APITestCase
from rest_framework.views import APIView

from .models import User
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
    def create_user(self, username="ali.test", **extra):
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
            {"username": "ali.test", "role": "HR", "must_change_password": False},
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
            {"username": "ali.test", "role": "MANAGER", "must_change_password": False},
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
