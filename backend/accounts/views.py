from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from rest_framework import status
from rest_framework.response import Response
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle

from . import mfa
from .models import SecuritySettings
from .permissions import IsIT
from .serializers import ChangePasswordSerializer, SecuritySettingsSerializer
from .services import logout_everywhere


def set_secure_cookie(response, name, value, max_age):
    response.set_cookie(name, value, max_age=max_age, httponly=True, samesite="Lax", secure=not settings.DEBUG)


def set_auth_cookies(response, access, refresh):
    set_secure_cookie(response, "access_token", access, settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds())
    set_secure_cookie(response, "refresh_token", refresh, settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds())


def user_info(user):
    """What login, login/mfa and me return, so the frontend knows where to go."""
    return {
        "username": user.username,
        "role": user.role,
        "is_superuser": user.is_superuser,  # IT: the frontend shows every page (the API checks too)
        "must_change_password": user.password_change_required(),
        "mfa_setup_required": mfa.setup_required(user),
    }


class RefreshView(TokenRefreshView):
    def post(self, request, *args, **kwargs):
        refresh_cookie = request.COOKIES.get("refresh_token")
        if refresh_cookie is None:
            raise InvalidToken("No refresh token cookie.")

        serializer = self.get_serializer(data={"refresh": refresh_cookie})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as e:
            raise InvalidToken(e.args[0]) from e

        access = serializer.validated_data["access"]
        refresh = serializer.validated_data["refresh"]

        response = Response({"detail": "Tokens refreshed."})
        set_auth_cookies(response, access, refresh)
        return response


class LoginView(TokenObtainPairView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as e:
            raise InvalidToken(e.args[0]) from e

        user = serializer.user
        if mfa.must_enter_code(request, user):
            # Password OK, but no session yet: the code is checked by login/mfa/.
            response = Response({"mfa_required": True})
            set_secure_cookie(response, "mfa_pending", mfa.pending_token(user), mfa.PENDING_MAX_AGE)
            return response

        response = Response(user_info(user))
        set_auth_cookies(
            response,
            serializer.validated_data["access"],
            serializer.validated_data["refresh"],
        )
        return response


class LogoutView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_cookie = request.COOKIES.get("refresh_token")
        if refresh_cookie is not None:
            try:
                RefreshToken(refresh_cookie).blacklist()
            except TokenError:
                pass

        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie("access_token", samesite="Lax")
        response.delete_cookie("refresh_token", samesite="Lax")
        return response


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        user = request.user
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.must_change_password = False
            user.save(update_fields=["password", "must_change_password"])

            # Kick out every other session: all existing refresh tokens die.
            logout_everywhere(user)

        # Keep the current session alive with a fresh token pair.
        refresh = RefreshToken.for_user(user)
        response = Response({"detail": "Password changed."})
        set_auth_cookies(response, str(refresh.access_token), str(refresh))
        return response


class MfaLoginView(APIView):
    """Login step 2: the 6-digit code (or a recovery code) after the password."""
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mfa"

    def post(self, request):
        user = mfa.pending_user(request)
        if user is None:
            return Response({"detail": "Session expired, please sign in again."}, status=status.HTTP_401_UNAUTHORIZED)

        code = str(request.data.get("code", ""))
        if not (mfa.verify_code(user, code) or mfa.use_recovery_code(user, code)):
            return Response({"code": ["Invalid code."]}, status=status.HTTP_400_BAD_REQUEST)

        refresh = RefreshToken.for_user(user)
        response = Response(user_info(user))
        set_auth_cookies(response, str(refresh.access_token), str(refresh))
        response.delete_cookie("mfa_pending", samesite="Lax")
        if request.data.get("remember"):
            set_secure_cookie(response, "mfa_trusted", mfa.trusted_token(user), mfa.TRUSTED_MAX_AGE)
        return response


class MfaSetupView(APIView):
    """Activation step 1: the QR code to scan (and the key, if the camera fails)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if mfa.is_enabled(request.user):
            return Response({"detail": "MFA is already active."}, status=status.HTTP_400_BAD_REQUEST)
        secret = mfa.pending_secret(request.user)
        return Response({"qr_code": mfa.qr_code(request.user, secret), "secret": secret})


class MfaConfirmView(APIView):
    """Activation step 2: a first valid code proves the phone is set up."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mfa"

    def post(self, request):
        user = request.user
        if mfa.is_enabled(user):
            return Response({"detail": "MFA is already active."}, status=status.HTTP_400_BAD_REQUEST)
        if not mfa.verify_code(user, str(request.data.get("code", ""))):
            return Response(
                {"code": ["Invalid code. Check the time on your phone and try again."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.mfa_enabled_at = timezone.now()
        user.save(update_fields=["mfa_enabled_at"])
        return Response({"recovery_codes": mfa.create_recovery_codes(user)})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(user_info(request.user))


class SecuritySettingsView(RetrieveUpdateAPIView):
    """The security settings, for IT only (same row as in the Django admin).

    GET   /api/auth/security-settings/ -> {"mfa_enabled": false, "mfa_required_hr": true, ...}
    PATCH /api/auth/security-settings/ -> only the fields that change

    Here IT is logged in WITH MFA (the Django admin login has none), so this page is the safer place."""

    serializer_class = SecuritySettingsSerializer
    permission_classes = [IsIT]
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return SecuritySettings.load()  # always the same row (created with the defaults if missing)