from django.contrib import admin

from employees.admin import ReferenceAdmin

from .models import LeaveType, PublicHoliday


@admin.register(LeaveType)
class LeaveTypeAdmin(ReferenceAdmin):
    list_display = ("name", "deducts_balance", "max_days", "is_active")
    list_filter = ("deducts_balance", "is_active")


@admin.register(PublicHoliday)
class PublicHolidayAdmin(ReferenceAdmin):
    list_display = ("date", "name", "is_active")
    list_filter = ("is_active",)
    date_hierarchy = "date"  # naviguer par année / mois en haut de la liste
