from rest_framework.permissions import BasePermission


class PasswordChanged(BasePermission):
    """Authenticated AND not forced to change the password first."""

    message = "You must change your password first."
    code = "password_change_required"

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and not user.must_change_password)
