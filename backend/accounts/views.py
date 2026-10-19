from django.conf import settings
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated


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
        response.set_cookie(
            "access_token",
            access,
            max_age=settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds(),
            httponly=True,
            samesite="Lax",
            secure=not settings.DEBUG)

        response.set_cookie("refresh_token",
            refresh,
            max_age=settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds(),
            httponly=True,
            samesite="Lax",
            secure=not settings.DEBUG)

        return response


class LoginView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)

        access = response.data.pop("access")
        refresh = response.data.pop("refresh")

        response.set_cookie(
            "access_token",
            access,
            max_age=settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds(),
            httponly=True,
            samesite="Lax",
            secure=not settings.DEBUG)

        response.set_cookie("refresh_token",
            refresh,
            max_age=settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds(),
            httponly=True,
            samesite="Lax",
            secure=not settings.DEBUG)

        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "username": request.user.username,
            "role": request.user.role,
            "must_change_password": request.user.must_change_password,
            })
