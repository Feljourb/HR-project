from rest_framework.permissions import BasePermission

from . import mfa
from .models import User


class AccountReady(BasePermission):
    """Default for every endpoint: logged in, password changed, MFA set up if required."""

    message = "You must change your password first."
    code = "password_change_required"

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated) or user.password_change_required():
            return False
        if mfa.setup_required(user):
            self.message = "You must set up two-factor authentication first."
            self.code = "mfa_setup_required"
            return False
        return True


class HasRole(AccountReady):
    """Base class: subclasses list the roles allowed in `allowed_roles`."""

    allowed_roles = ()

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:  # IT always has access
            return True
        if request.user.role not in self.allowed_roles:
            self.message = "You do not have the required role."
            self.code = "role_required"
            return False
        return True


class IsHRAdmin(HasRole):
    allowed_roles = (User.Role.HR_ADMIN,)


class IsHR(HasRole):
    allowed_roles = (User.Role.HR_ADMIN, User.Role.HR)


class IsManager(HasRole):
    allowed_roles = (User.Role.MANAGER,)
