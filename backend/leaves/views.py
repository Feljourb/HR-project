"""Step 6 : l'API des congés (tous les rôles ; chacun voit SES congés).

GET  /api/leaves/types/            -> les types actifs (la liste du formulaire)
GET  /api/leaves/holidays/?year=   -> les jours fériés actifs (d'une année)
GET  /api/leaves/mine/             -> mes congés, le plus récent d'abord
POST /api/leaves/mine/             -> envoyer une demande (les règles, puis le circuit)
POST /api/leaves/mine/preview/     -> le calcul en direct (jours, détail, solde après, règle bloquante)
GET  /api/leaves/mine/balance/     -> mon solde
Annuler : /api/workflows/requests/<request>/cancel/ (le moteur s'en occupe, comme pour toutes les demandes).

Step 8 (RH) :
GET  /api/leaves/absences/?date_from=2026-11-01&date_to=2026-11-30 -> les congés en cours / acceptés de la période
GET/POST/PATCH /api/leaves/lists/leave-types/ et /lists/public-holidays/ -> les listes (voir urls.py)
"""
import datetime

from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from accounts.permissions import IsHR
from employees.models import Employee
from employees.services import limited_to_own_pole, user_pole
from workflows.views import run

from .balance import balance
from .models import LeaveRequest, LeaveType, PublicHoliday
from .serializers import (
    AbsenceSerializer, LeaveInputSerializer, LeaveRequestSerializer, LeaveTypeSerializer, PublicHolidaySerializer,
)
from .services import preview_leave, request_leave


class LeaveTypeViewSet(viewsets.ReadOnlyModelViewSet):
    # Seulement les types actifs : un type désactivé par Admin RH ne se propose plus.
    queryset = LeaveType.objects.filter(is_active=True)
    serializer_class = LeaveTypeSerializer


class PublicHolidayViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PublicHolidaySerializer

    def get_queryset(self):
        holidays = PublicHoliday.objects.filter(is_active=True)
        year = self.request.query_params.get("year")
        return holidays.filter(date__year=year) if year and year.isdigit() else holidays


class MyLeaveViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = LeaveRequestSerializer

    def get_queryset(self):
        return LeaveRequest.objects.filter(employee__user=self.request.user).select_related("leave_type", "request")

    def employee(self):
        """MON dossier RH. Un compte sans dossier (ex. un compte IT) n'a pas de congés."""
        employee = Employee.objects.filter(user=self.request.user).first()
        if employee is None:
            raise NotFound("Aucun dossier RH n'est lié à ce compte.")
        return employee

    def read_input(self):
        data = LeaveInputSerializer(data=self.request.data)
        data.is_valid(raise_exception=True)  # 400 avec le champ en faute (ex. une date mal écrite)
        return data.validated_data

    def create(self, request):
        fields = self.read_input()
        employee = self.employee()
        # run : une règle refusée (ex. "Solde insuffisant...") -> 400 {"detail": "..."}.
        leave = run(lambda: request_leave(employee, **fields))
        return Response(LeaveRequestSerializer(leave).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def preview(self, request):
        fields = self.read_input()
        fields.pop("reason")  # le motif ne change pas le calcul
        return Response(preview_leave(self.employee(), **fields))

    # Pas "def balance" : ce nom cacherait la fonction balance() importée en haut.
    @action(detail=False, methods=["get"], url_path="balance", url_name="balance")
    def my_balance(self, request):
        return Response(balance(self.employee()))


def period_param(params, name):
    """Une date de l'adresse (?date_from=2026-11-01). Absente ou fausse (ex. 2026-02-30) : erreur 400 claire."""
    try:
        value = parse_date(params.get(name) or "")
    except ValueError:  # bien écrite mais impossible (30 février)
        value = None
    if value is None:
        raise ValidationError({"detail": f"{name} : une date AAAA-MM-JJ est obligatoire."})
    return value


class AbsenceViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Qui est absent, et quand (page "Absences", RH / Admin RH / IT).
    Les congés EN COURS aussi (marqués) : le RH voit ce qui arrive, avant même la validation.
    RH : seulement son pôle ; Admin RH et IT : les deux pôles (comme le tableau des collaborateurs)."""

    serializer_class = AbsenceSerializer
    permission_classes = [IsHR]

    def get_queryset(self):
        params, user = self.request.query_params, self.request.user
        start, end = period_param(params, "date_from"), period_param(params, "date_to")
        if end < start or end - start > datetime.timedelta(days=366):
            raise ValidationError({"detail": "Période invalide (au plus un an, la fin après le début)."})

        leaves = (
            LeaveRequest.objects.filter(request__status__in=LeaveRequest.ACTIVE, start_date__lte=end, end_date__gte=start)
            .select_related("leave_type", "request", "employee__department__direction__entity__pole")
            .order_by("start_date", "employee__last_name")
        )
        if limited_to_own_pole(user):
            pole = user_pole(user)
            # Un RH sans dossier n'a pas de pôle : il ne voit rien (plus sûr que tout montrer).
            leaves = leaves.filter(employee__department__direction__entity__pole=pole) if pole else leaves.none()
        return leaves
