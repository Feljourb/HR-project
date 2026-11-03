from django.contrib import admin

from employees.admin import ReferenceAdmin

from .models import ExpenseCategory, ExpenseClaim, ExpenseLine, ExpenseScale


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(ReferenceAdmin):
    list_display = ("name", "ceiling", "receipt_required", "is_active")
    list_filter = ("ceiling", "receipt_required", "is_active")


@admin.register(ExpenseScale)
class ExpenseScaleAdmin(admin.ModelAdmin):
    list_display = ("grade", "daily_allowance", "transport", "hotel")

    def has_delete_permission(self, request, obj=None):
        return False  # un barème se corrige, il ne se supprime pas (comme les listes)


# --- Les notes de frais : en lecture seule (elles changent seulement par leur circuit et le remboursement) ---

class ExpenseLineInline(admin.TabularInline):
    model = ExpenseLine
    extra = 0
    fields = ("date", "category", "amount", "description", "receipt_name")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


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
