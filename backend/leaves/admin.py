from django.contrib import admin
from django.db import transaction

from employees.admin import ReferenceAdmin

from .models import (
    AnnualRightChange, BalanceAdjustment, LeaveRecount, LeaveRequest, LeaveSettings, LeaveType, PublicHoliday,
)
from .recount import holiday_changed


@admin.register(LeaveType)
class LeaveTypeAdmin(ReferenceAdmin):
    list_display = ("name", "deducts_balance", "max_days", "is_active")
    list_filter = ("deducts_balance", "is_active")


@admin.register(PublicHoliday)
class PublicHolidayAdmin(ReferenceAdmin):
    list_display = ("date", "name", "estimated", "is_active")
    list_filter = ("estimated", "is_active")
    date_hierarchy = "date"  # naviguer par année / mois en haut de la liste

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        # Comme la page Reference lists : les congés touchés par ce jour férié sont recomptés (recount.py).
        old = PublicHoliday.objects.filter(pk=obj.pk).values_list("date", "is_active").first() if change else None
        super().save_model(request, obj, form, change)
        holiday_changed(obj, tuple(old) if old else None, request.user)


@admin.register(LeaveSettings)
class LeaveSettingsAdmin(admin.ModelAdmin):
    fieldsets = (
        ("Calcul du solde", {
            "description": "Depuis l'embauche, chaque mois complet rapporte (droit annuel de la fiche + ancienneté) / 12. "
                           "Les jours gagnés une année se prennent pendant N ans (2 : jusqu'au 31/12 de l'année suivante), "
                           "puis ils sont perdus.",
            "fields": ("carry_over_years", "months_before_first_leave"),
        }),
        ("Ancienneté et maximum", {"fields": ("seniority_years", "seniority_bonus", "max_days_per_year")}),
    )

    # Une seule ligne : on la modifie, on ne l'ajoute pas deux fois et on ne la supprime jamais.
    def has_add_permission(self, request):
        return not LeaveSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AnnualRightChange)
class AnnualRightChangeAdmin(admin.ModelAdmin):
    """P1 step 2 : l'historique du droit annuel, en lecture seule (il se change depuis la page Leave balances)."""
    list_display = ("employee", "effective_from", "annual_days", "reason", "changed_by", "created_at")
    search_fields = ("employee__last_name", "employee__first_name")
    readonly_fields = list_display
    list_select_related = ("employee", "changed_by")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BalanceAdjustment)
class BalanceAdjustmentAdmin(admin.ModelAdmin):
    """P1 step 3 : les corrections du solde, en lecture seule (elles se font depuis la page Leave balances)."""
    list_display = ("employee", "date", "days", "reason", "created_by", "created_at")
    search_fields = ("employee__last_name", "employee__first_name")
    readonly_fields = list_display
    list_select_related = ("employee", "created_by")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class RecountInline(admin.TabularInline):
    """Les recalculs du congé (un jour férié a changé), en lecture seule : c'est son historique."""
    model = LeaveRecount
    extra = 0
    can_delete = False
    readonly_fields = ("created_at", "old_days", "new_days", "reason", "warning", "changed_by")
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    inlines = [RecountInline]
    # En lecture seule, comme les demandes du moteur : un congé change seulement par son circuit.
    list_display = ("employee", "leave_type", "start_date", "end_date", "days", "status")
    list_filter = ("leave_type", "request__status")
    search_fields = ("employee__last_name", "employee__first_name")
    readonly_fields = ("request", "employee", "leave_type", "start_date", "end_date",
                       "starts_afternoon", "ends_noon", "days", "reason", "recorded_by")
    date_hierarchy = "start_date"
    list_select_related = ("request", "employee", "leave_type")  # une seule requête SQL pour toute la liste

    @admin.display(description="Statut")
    def status(self, leave):
        return leave.request.get_status_display()  # le statut vient du moteur

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
