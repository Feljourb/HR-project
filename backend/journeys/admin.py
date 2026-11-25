from django.contrib import admin

from .models import Departure, Journey, JourneySettings, JourneyTask, NoticeRule, TaskTemplate


@admin.register(JourneySettings)
class JourneySettingsAdmin(admin.ModelAdmin):
    """Une seule ligne (Admin RH la change dans Reference lists ; ici pour l'IT)."""
    list_display = ("__str__", "employee_can_request_departure", "updated_at")
    readonly_fields = ("updated_at", "updated_by")

    def has_add_permission(self, request):
        return not JourneySettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(NoticeRule)
class NoticeRuleAdmin(admin.ModelAdmin):
    """La grille du préavis : la durée et l'unité changent ; les 6 lignes restent (ni ajout, ni suppression)."""
    list_display = ("group", "min_years", "amount", "unit")
    readonly_fields = ("group", "min_years")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Departure)
class DepartureAdmin(admin.ModelAdmin):
    """Les demandes de départ : en LECTURE (la trace ; la lettre seulement par l'API, jamais une adresse publique)."""
    list_display = ("employee", "departure_type", "last_day", "notice_until", "notice_status", "created_at", "journey")
    list_filter = ("departure_type",)
    exclude = ("letter",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TaskTemplate)
class TaskTemplateAdmin(admin.ModelAdmin):
    """Le modèle des tâches (Admin RH le change dans Reference lists ; ici pour l'IT). Jamais supprimé : décocher Actif."""
    list_display = ("name", "kind", "owner", "person", "offset_days", "detail_label", "is_active")
    list_filter = ("kind", "owner", "is_active")

    def has_delete_permission(self, request, obj=None):
        return False


class JourneyTaskInline(admin.TabularInline):
    model = JourneyTask
    extra = 0
    fields = ("name", "owner", "person", "due_date", "detail", "comment", "done_at", "done_by")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Journey)
class JourneyAdmin(admin.ModelAdmin):
    """Les parcours : en LECTURE (la trace) ; on les suit et on les change dans la page "Arrivals & departures"."""
    list_display = ("employee", "kind", "day", "created_at", "cancelled_at")
    list_filter = ("kind",)
    search_fields = ("employee__last_name", "employee__first_name", "employee__u_number")
    inlines = [JourneyTaskInline]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
