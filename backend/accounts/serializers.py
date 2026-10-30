from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import SecuritySettings


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value, user=self.context["request"].user)
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": "New password must be different from the current one."}
            )
        return attrs


class SecuritySettingsSerializer(serializers.ModelSerializer):
    """The single security row (MFA + password change at first sign-in), for the IT page."""

    class Meta:
        model = SecuritySettings
        exclude = ["id"]