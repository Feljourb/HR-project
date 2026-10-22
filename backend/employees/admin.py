from django.contrib import admin

from .models import (
    Assignment, Bank, Category, ContractType, CostCenter, Department, Direction, Division,
    Entity, Grade, Pole, Position, Region, TempAgency,
)


class ReferenceAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)

    # Never delete a value used by employees: untick "Actif" instead.
    def has_delete_permission(self, request, obj=None):
        return False


for model in (Pole, Division, Assignment,Category, ContractType, TempAgency, Grade, Region, Bank):
    admin.site.register(model, ReferenceAdmin)


@admin.register(Entity)
class EntityAdmin(ReferenceAdmin):
    list_display = ("name", "pole", "is_active")
    list_filter = ("pole", "is_active")


@admin.register(Direction)
class DirectionAdmin(ReferenceAdmin):
    list_display = ("name", "entity", "is_active")
    list_filter = ("entity__pole", "entity", "is_active")


@admin.register(Department)
class DepartmentAdmin(ReferenceAdmin):
    list_display = ("name", "direction", "is_active")
    list_filter = ("direction__entity", "direction", "is_active")


@admin.register(Position)
class PositionAdmin(ReferenceAdmin):
    list_display = ("name", "department", "direction", "is_active")
    list_filter = ("department__direction__entity", "department__direction", "department", "is_active")
    list_select_related = ("department__direction",)

    @admin.display(description="Direction", ordering="department__direction__name")
    def direction(self, obj):
        return obj.department.direction


@admin.register(CostCenter)
class CostCenterAdmin(ReferenceAdmin):
    list_display = ("code", "name", "is_active")
    search_fields = ("code", "name")

