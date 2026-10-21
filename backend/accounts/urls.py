from django.urls import path

from .views import (
    ChangePasswordView, LoginView, LogoutView, MeView, MfaConfirmView, MfaLoginView, MfaSetupView,
    RefreshView,
)

app_name = "accounts"

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("login/mfa/", MfaLoginView.as_view(), name="login-mfa"),
    path("refresh/", RefreshView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("mfa/setup/", MfaSetupView.as_view(), name="mfa-setup"),
    path("mfa/confirm/", MfaConfirmView.as_view(), name="mfa-confirm"),
]
