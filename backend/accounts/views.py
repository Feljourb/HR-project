from django.conf import settings
from rest_framework_simplejwt.views import TokenObtainPairView

from rest_framework.response import Response
from rest_framework.views import APIView



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
    def get(self, request):
        return Response({"user": str(request.user)})