from django.contrib import admin

from employees.admin import ReferenceAdmin

from .models import LeaveRequest, LeaveSettings, LeaveType, PublicHoliday


@admin.register(LeaveType)
class LeaveTypeAdmin(ReferenceAdmin):
    list_display = ("name", "deducts_balance", "max_days", "is_active")
    list_filter = ("deducts_balance", "is_active")


@admin.register(PublicHoliday)
class PublicHolidayAdmin(ReferenceAdmin):
    list_display = ("date", "name", "estimated", "is_active")
    list_filter = ("estimated", "is_active")
    date_hierarchy = "date"  # naviguer par année / mois en haut de la liste


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


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    # En lecture seule, comme les demandes du moteur : un congé change seulement par son circuit.
    list_display = ("employee", "leave_type", "start_date", "end_date", "days", "status")
    list_filter = ("leave_type", "request__status")
    search_fields = ("employee__last_name", "employee__first_name")
    readonly_fields = ("request", "employee", "leave_type", "start_date", "end_date",
                       "starts_afternoon", "ends_noon", "days", "reason")
    date_hierarchy = "start_date"
    list_select_related = ("request", "employee", "leave_type")  # une seule requête SQL pour toute la liste

    @admin.display(description="Statut")
    def status(self, leave):
        return leave.request.get_status_display()  # le statut vient du moteur

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
