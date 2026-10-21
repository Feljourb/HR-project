from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import SecuritySettings, User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "role", "is_active")
    search_fields = ("username",)
    ordering = ("username",)
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Informations", {"fields": ("email", "role", "must_change_password")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"fields": ("username", "password1", "password2", "role")}),
    )


@admin.register(SecuritySettings)
class SecuritySettingsAdmin(admin.ModelAdmin):
    fieldsets = (
        ("Double authentification (MFA)", {"fields": ("mfa_enabled",)}),
        ("MFA obligatoire pour", {"fields": (
            "mfa_required_hr_admin", "mfa_required_hr", "mfa_required_manager",
            "mfa_required_collaborator", "mfa_required_superuser",
        )}),
    )

    # Only IT (superusers) may see or change it. There is exactly one row.
    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return request.user.is_superuser and not SecuritySettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
