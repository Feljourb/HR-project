from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from . import mfa, services
from .models import SecuritySettings, User


@admin.action(description="Réinitialiser le MFA (téléphone perdu)")
def reset_mfa(modeladmin, request, queryset):
    if not request.user.is_superuser:
        modeladmin.message_user(request, "Réservé à l'IT.", messages.ERROR)
        return
    for user in queryset:
        mfa.reset(user)
    modeladmin.message_user(request, f"MFA réinitialisé pour {queryset.count()} utilisateur(s).")


@admin.action(description="Réinitialiser le mot de passe (mot de passe oublié)")
def reset_password(modeladmin, request, queryset):
    """Action de l'IT : un mot de passe temporaire aléatoire par compte, affiché une seule fois
    dans le message en haut de la page. Le compte devra le changer à la prochaine connexion."""
    if not request.user.is_superuser:
        modeladmin.message_user(request, "Réservé à l'IT.", messages.ERROR)
        return
    from employees import history  # import ici : l'app accounts ne dépend pas d'employees au chargement
    from employees.models import EmployeeHistory

    for user in queryset:
        password = services.reset_password(user)
        if hasattr(user, "employee"):  # un compte avec un dossier RH : on le note dans son historique
            history.record(user.employee, request.user, EmployeeHistory.Action.PASSWORD_RESET)
        modeladmin.message_user(
            request,
            f"{user.username} : mot de passe temporaire {password} (à changer à la prochaine connexion).",
            messages.WARNING,  # en jaune : à noter maintenant, il ne sera plus affiché
        )


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "role", "is_active", "mfa_active")
    actions = [reset_mfa, reset_password]

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

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        # L'IT change le rôle d'un compte qui a un dossier RH : on le note dans son historique.
        if change and "role" in form.changed_data and hasattr(obj, "employee"):
            from employees import history  # import ici : voir reset_password plus haut

            old_label = User.Role(form.initial["role"]).label
            history.record_role(obj.employee, request.user, old_label, obj.get_role_display())


@admin.register(SecuritySettings)
class SecuritySettingsAdmin(admin.ModelAdmin):
    fieldsets = (
        ("Double authentification (MFA)", {"fields": ("mfa_enabled",)}),
        ("MFA obligatoire pour", {"fields": (
            "mfa_required_hr_admin", "mfa_required_hr", "mfa_required_manager",
            "mfa_required_collaborator", "mfa_required_superuser",
        )}),
        ("Changement de mot de passe", {"fields": ("password_change_enabled",)}),
        ("Changement obligatoire pour", {
            "description": (
                "⚠️ Un nouveau compte a son CIN comme mot de passe temporaire. "
                "Si une case est décochée (ou le changement désactivé), les comptes de ce rôle "
                "peuvent garder leur CIN comme mot de passe."
            ),
            "fields": (
                "password_change_hr_admin", "password_change_hr", "password_change_manager",
                "password_change_collaborator", "password_change_superuser",
            ),
        }),
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
