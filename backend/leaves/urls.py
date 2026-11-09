"""Adresses de l'app leaves (incluses sous /api/leaves/ dans core/urls.py)."""
from django.db import transaction
from django.urls import path
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.routers import SimpleRouter

from employees.views import make_viewset

from .models import LeaveType, PublicHoliday
from .recount import holiday_changed
from .serializers import HolidayListSerializer
from .views import (
    AbsenceViewSet, BalanceViewSet, LeaveTypeViewSet, MyLeaveViewSet, PublicHolidayViewSet, RecountViewSet,
    TeamCalendarView, ensure_coming_years,
)


class HolidayListViewSet(make_viewset(PublicHoliday)):
    """Les jours fériés dans la page "Reference lists", ANNÉE PAR ANNÉE (décision du 2026-11-03, avec l'encadrant) :
    chaque année a SES lignes (l'Aïd 2026 et l'Aïd 2027 sont deux lignes) : rien n'est jamais remplacé ni effacé.
    GET ?year=2026 (par défaut : cette année) ; GET years/ -> les années à choisir.
    Une année PASSÉE est en lecture seule : c'est l'historique (les anciens congés ont été comptés avec)."""

    serializer_class = HolidayListSerializer  # le message "date déjà prise" en français (voir le serializer)

    def get_queryset(self):
        ensure_coming_years()
        queryset = super().get_queryset()
        if self.action != "list":
            return queryset  # modifier un jour férié : par son id
        year = self.request.query_params.get("year", "")
        return queryset.filter(date__year=int(year) if year.isdigit() else timezone.localdate().year)

    @action(detail=False, methods=["get"])
    def years(self, request):
        """[2025, 2026, 2027] : les années qui ont des jours fériés (+ cette année et la suivante), et la courante."""
        ensure_coming_years()
        years = [day.year for day in PublicHoliday.objects.dates("date", "year")]
        return Response({"years": years, "current": timezone.localdate().year})

    def refuse_past_year(self, *dates):
        if any(day and day.year < timezone.localdate().year for day in dates):
            raise ValidationError({"date": ["Année passée : ses jours fériés restent tels quels (historique des congés)."]})

    # atomic : le jour férié ET le recalcul des congés touchés (recount.py) sont enregistrés ensemble, ou pas du tout.
    @transaction.atomic
    def perform_create(self, serializer):
        self.refuse_past_year(serializer.validated_data.get("date"))
        super().perform_create(serializer)
        holiday_changed(serializer.instance, None, self.request.user)

    @transaction.atomic
    def perform_update(self, serializer):
        holiday = serializer.instance
        self.refuse_past_year(holiday.date, serializer.validated_data.get("date"))
        before = (holiday.date, holiday.is_active)  # AVANT l'enregistrement
        super().perform_update(serializer)
        holiday_changed(holiday, before, self.request.user)

app_name = "leaves"

router = SimpleRouter()
# Step 8 : les deux listes du module dans la page "Reference lists" (Admin RH : ajouter, modifier, désactiver),
# avec EXACTEMENT les mêmes règles que les autres listes (make_viewset de l'app employees) :
# GET pour tous (?all=1 : aussi les désactivées, Admin RH), POST / PATCH Admin RH, jamais DELETE.
router.register("lists/leave-types", make_viewset(LeaveType), basename="list-leave-types")
router.register("lists/public-holidays", HolidayListViewSet, basename="list-public-holidays")
# Step 8 : les absences du pôle (RH).
router.register("absences", AbsenceViewSet, basename="absence")
# P1 step 1 : le solde de chaque collaborateur du pôle (RH) : "leaves:balances-list".
router.register("balances", BalanceViewSet, basename="balances")

router.register("types", LeaveTypeViewSet, basename="type")
router.register("holidays", PublicHolidayViewSet, basename="holiday")
router.register("mine", MyLeaveViewSet, basename="mine")  # "leaves:mine-list", "leaves:mine-preview"...
# Les recalculs d'un congé (un jour férié a changé), pour l'historique de la demande.
router.register("recounts", RecountViewSet, basename="recount")

# P2 step 2 : le calendrier de l'équipe pour le valideur d'un congé : "leaves:team-calendar".
urlpatterns = [*router.urls, path("team-calendar/", TeamCalendarView.as_view(), name="team-calendar")]
