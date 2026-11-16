from django.contrib import admin

from employees.admin import ReferenceAdmin

from .models import Currency, ExpenseCategory, ExpenseClaim, ExpenseCorrection, ExpenseLine, ExpenseScale, ExpenseSettings


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(ReferenceAdmin):
    list_display = ("name", "ceiling", "receipt_required", "above_ceiling_allowed", "is_active")
    list_filter = ("ceiling", "receipt_required", "above_ceiling_allowed", "is_active")


@admin.register(Currency)
class CurrencyAdmin(ReferenceAdmin):
    list_display = ("name", "rate_to_mad", "automatic", "rate_updated_at", "is_active")


@admin.register(ExpenseScale)
class ExpenseScaleAdmin(admin.ModelAdmin):
    list_display = ("grade", "daily_allowance", "transport", "hotel")

    def has_delete_permission(self, request, obj=None):
        return False  # un barème se corrige, il ne se supprime pas (comme les listes)


# --- Les notes de frais : en lecture seule (elles changent seulement par leur circuit et le remboursement) ---

class ExpenseLineInline(admin.TabularInline):
    model = ExpenseLine
    extra = 0
    fields = ("date", "category", "original_amount", "currency", "rate", "amount", "ceiling", "justification",
              "description", "receipt_names")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    @admin.display(description="Justificatifs")
    def receipt_names(self, line):
        return ", ".join(receipt.name for receipt in line.receipts.all()) or "-"


@admin.register(ExpenseClaim)
class ExpenseClaimAdmin(admin.ModelAdmin):
    list_display = ("title", "employee", "total", "status", "reimbursed_at")
    list_filter = ("request__status",)
    search_fields = ("title", "employee__last_name", "employee__first_name")
    readonly_fields = ("request", "employee", "title", "total", "reimbursed_at", "reimbursed_by")
    list_select_related = ("request", "employee")
    inlines = [ExpenseLineInline]

    @admin.display(description="Statut")
    def status(self, claim):
        return claim.request.get_status_display()  # le statut vient du moteur

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ExpenseSettings)
class ExpenseSettingsAdmin(admin.ModelAdmin):
    """Une seule ligne (Admin RH la change dans la page Reference lists ; ici pour l'IT)."""
    list_display = ("__str__", "who_can_correct", "updated_at", "updated_by")
    readonly_fields = ("updated_at", "updated_by")

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    def has_add_permission(self, request):
        return not ExpenseSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ExpenseCorrection)
class ExpenseCorrectionAdmin(admin.ModelAdmin):
    """Les corrections des montants par les valideurs : la trace, en lecture seule."""
    list_display = ("corrected_at", "line", "old_amount", "new_amount", "reason", "corrected_by", "as_role")
    readonly_fields = list_display
    list_select_related = ("line__category", "corrected_by")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
