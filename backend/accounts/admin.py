from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from . import mfa
from .models import SecuritySettings, User


@admin.action(description="Réinitialiser le MFA (téléphone perdu)")
def reset_mfa(modeladmin, request, queryset):
    if not request.user.is_superuser:
        modeladmin.message_user(request, "Réservé à l'IT.", messages.ERROR)
        return
    for user in queryset:
        mfa.reset(user)
    modeladmin.message_user(request, f"MFA réinitialisé pour {queryset.count()} utilisateur(s).")


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "role", "is_active", "mfa_active")
    actions = [reset_mfa]

    @admin.display(boolean=True, description="MFA")
    def mfa_active(self, obj):
        return obj.mfa_enabled_at is not None

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
