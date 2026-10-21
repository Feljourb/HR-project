from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle

from . import mfa
from .serializers import ChangePasswordSerializer


def set_auth_cookies(response, access, refresh):
    response.set_cookie(
        "access_token",
        access,
        max_age=settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds(),
        httponly=True,
        samesite="Lax",
        secure=not settings.DEBUG,
    )
    response.set_cookie(
        "refresh_token",
        refresh,
        max_age=settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds(),
        httponly=True,
        samesite="Lax",
        secure=not settings.DEBUG,
    )


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
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as e:
            raise InvalidToken(e.args[0]) from e

        user = serializer.user
        response = Response({
            "username": user.username,
            "role": user.role,
            "must_change_password": user.must_change_password,
        })
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
            for token in OutstandingToken.objects.filter(user=user):
                BlacklistedToken.objects.get_or_create(token=token)

        # Keep the current session alive with a fresh token pair.
        refresh = RefreshToken.for_user(user)
        response = Response({"detail": "Password changed."})
        set_auth_cookies(response, str(refresh.access_token), str(refresh))
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
        return Response({
            "username": request.user.username,
            "role": request.user.role,
            "must_change_password": request.user.must_change_password,
            })
