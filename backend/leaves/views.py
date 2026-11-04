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
                                                     (&status=all : aussi les refusés et les annulés)
GET  /api/leaves/absences/summary/?date_from=...&date_to=...      -> les chiffres de la période (les cases de la page)
GET/POST/PATCH /api/leaves/lists/leave-types/ et /lists/public-holidays/ -> les listes (voir urls.py)
"""
import datetime

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from accounts.permissions import IsHR
from employees.models import Employee
from employees.services import limited_to_own_pole, user_pole
from workflows import engine
from workflows.models import Request
from workflows.serializers import person
from workflows.views import run

from .balance import balance, balance_by_year, yearly_right
from .counting import day_values
from .holidays import ensure_year
from .models import AnnualRightChange, LeaveRecount, LeaveRequest, LeaveSettings, LeaveType, PublicHoliday
from .serializers import (
    AbsenceSerializer, LeaveInputSerializer, LeaveRequestSerializer, LeaveTypeSerializer, PublicHolidaySerializer,
    RecountSerializer, RightChangeInputSerializer, RightChangeSerializer,
)
from .services import can_change_right, change_annual_right, preview_leave, request_leave


class LeaveTypeViewSet(viewsets.ReadOnlyModelViewSet):
    # Seulement les types actifs : un type désactivé par Admin RH ne se propose plus.
    queryset = LeaveType.objects.filter(is_active=True)
    serializer_class = LeaveTypeSerializer


def ensure_coming_years(*years):
    """Cette année et la suivante (+ celles demandées) ont leurs jours fériés (créés tout seuls, voir holidays.py)."""
    this_year = timezone.localdate().year
    for year in {this_year, this_year + 1, *years}:
        ensure_year(year)


class PublicHolidayViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PublicHolidaySerializer

    def get_queryset(self):
        year = self.request.query_params.get("year")
        year = int(year) if year and year.isdigit() and 1924 < int(year) < 2078 else None
        ensure_coming_years(*([year] if year else []))
        holidays = PublicHoliday.objects.filter(is_active=True)
        return holidays.filter(date__year=year) if year else holidays


class MyLeaveViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = LeaveRequestSerializer

    def get_queryset(self):
        return (LeaveRequest.objects.filter(employee__user=self.request.user)
                .select_related("leave_type", "request").prefetch_related("recounts"))

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


class BalanceViewSet(viewsets.GenericViewSet):
    """P1 step 1 : la page "Leave balances" (RH) : le solde de chaque collaborateur, sur un seul écran.
    GET /api/leaves/balances/ (?left=1 : aussi les "Sorti", pour leurs jours restants au départ).
    RH : son pôle ; Admin RH et IT : les deux pôles (comme le tableau des collaborateurs).
    Chaque solde est calculé par la MÊME fonction balance() que la page du collaborateur : mêmes chiffres partout.
    Limite connue : un calcul par personne (rapide pour quelques centaines ; voir l'optimisation plus tard)."""

    permission_classes = [IsHR]

    def get_queryset(self):
        user = self.request.user
        employees = (Employee.objects.select_related("department__direction__entity__pole")
                     .order_by("last_name", "first_name"))
        if self.request.query_params.get("left") != "1":
            employees = employees.exclude(status=Employee.Status.LEFT)
        if limited_to_own_pole(user):
            pole = user_pole(user)
            # Un RH sans dossier n'a pas de pôle : il ne voit rien (plus sûr que tout montrer).
            employees = employees.filter(department__direction__entity__pole=pole) if pole else employees.none()
        return employees

    def row(self, employee, settings, today):
        return {
            "employee_id": employee.pk,
            "employee": person(employee),
            "department": employee.department.name,
            "pole": employee.pole.name,
            "status": employee.status,
            "hire_date": employee.hire_date,
            "yearly_right": float(yearly_right(employee, settings, today)),  # droit + ancienneté, aujourd'hui
            **balance(employee, today),
        }

    def list(self, request):
        settings, today = LeaveSettings.load(), timezone.localdate()
        return Response([self.row(employee, settings, today) for employee in self.get_queryset()])

    def retrieve(self, request, pk=None):
        """GET /api/leaves/balances/<employee>/ -> le panneau du clic : la ligne du tableau, + le détail
        année par année (les tirelires) et ses congés (tous les types : la liste complète pour les RH).
        Un collaborateur hors du pôle du RH : 404 (comme s'il n'existait pas). Les "Sorti" aussi s'ouvrent."""
        employee = (Employee.objects.select_related("department__direction__entity__pole")
                    .filter(pk=pk, pk__in=self.visible_ids()).first()) if str(pk).isdigit() else None
        if employee is None:
            raise NotFound("Collaborateur introuvable.")
        settings, today = LeaveSettings.load(), timezone.localdate()
        leaves = (LeaveRequest.objects.filter(employee=employee).select_related("leave_type", "request")
                  .prefetch_related("recounts"))
        changes = AnnualRightChange.objects.filter(employee=employee).select_related("changed_by")
        return Response({
            **self.row(employee, settings, today),
            "base_right": float(employee.annual_leave_days),  # le droit de la fiche, depuis l'embauche
            "right_changes": RightChangeSerializer(changes, many=True).data,
            "can_change_right": can_change_right(request.user, employee),
            "years": balance_by_year(employee, today),
            "leaves": LeaveRequestSerializer(leaves, many=True).data,
        })

    @action(detail=True, methods=["post"])
    def right(self, request, pk=None):
        """POST /api/leaves/balances/<employee>/right/ {"annual_days": 30, "effective_from": "2026-09-01",
        "reason": "Promotion manager"} -> P1 step 2 : le nouveau droit, à partir de cette date. Répond le panneau à jour."""
        employee = Employee.objects.filter(pk=pk, pk__in=self.visible_ids()).first() if str(pk).isdigit() else None
        if employee is None:
            raise NotFound("Collaborateur introuvable.")
        data = RightChangeInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        run(lambda: change_annual_right(employee, user=request.user, **data.validated_data))
        return self.retrieve(request, pk=pk)

    def visible_ids(self):
        """Les collaborateurs que ce RH peut ouvrir : son pôle (Admin RH, IT : tous), "Sorti" compris."""
        user, employees = self.request.user, Employee.objects.all()
        if limited_to_own_pole(user):
            pole = user_pole(user)
            employees = employees.filter(department__direction__entity__pole=pole) if pole else employees.none()
        return employees.values("pk")


class RecountViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """GET /api/leaves/recounts/?request=12 -> les recalculs de CE congé (un jour férié a changé), pour la ligne
    du temps de /requests/12. Mêmes droits que l'historique de la demande (sinon : liste vide)."""

    serializer_class = RecountSerializer

    def get_queryset(self):
        request_id = self.request.query_params.get("request", "")
        if not request_id.isdigit():
            return LeaveRecount.objects.none()
        return (LeaveRecount.objects.filter(leave__request=int(request_id),
                                            leave__request__in=engine.requests_visible_to(self.request.user))
                .select_related("changed_by"))


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

        # Par défaut : les absences (en cours + acceptées). ?status=all : aussi les refusées et les annulées,
        # pour que les RH retrouvent TOUTES les demandes et leur historique (les filtres sont dans la page).
        statuses = Request.Status.values if params.get("status") == "all" else LeaveRequest.ACTIVE
        leaves = (
            LeaveRequest.objects.filter(request__status__in=statuses, start_date__lte=end, end_date__gte=start)
            .select_related("leave_type", "request", "employee__department__direction__entity__pole")
            .prefetch_related("recounts")
            .order_by("start_date", "employee__last_name")
        )
        if limited_to_own_pole(user):
            pole = user_pole(user)
            # Un RH sans dossier n'a pas de pôle : il ne voit rien (plus sûr que tout montrer).
            leaves = leaves.filter(employee__department__direction__entity__pole=pole) if pole else leaves.none()
        return leaves

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """GET /api/leaves/absences/summary/?date_from=&date_to= -> les chiffres de la période, pour les cases
        de la page (que les RH téléchargent en image pour leurs présentations) :
        {"people": 4, "absent_today": 1, "approved_days": 12.5, "pending_days": 3}.
        Même requête que le tableau (get_queryset) : même période, même pôle, mêmes droits.
        Les jours comptés sont ceux DANS la période : un congé du 28/10 au 05/11 compte ses jours de novembre."""
        params = request.query_params
        start, end = period_param(params, "date_from"), period_param(params, "date_to")
        today = timezone.localdate()
        people, absent_today, days = set(), set(), {"approved": 0, "pending": 0}
        # Toujours les absences seulement : un congé refusé ou annulé n'éloigne personne du bureau.
        for leave in self.get_queryset().filter(request__status__in=LeaveRequest.ACTIVE):
            in_period = sum(value for day, value in day_values(leave.start_date, leave.end_date, leave.starts_afternoon,
                                                               leave.ends_noon) if start <= day <= end)
            approved = leave.request.status == Request.Status.APPROVED
            days["approved" if approved else "pending"] += in_period
            people.add(leave.employee_id)
            if approved and leave.start_date <= today <= leave.end_date:
                absent_today.add(leave.employee_id)
        return Response({"people": len(people), "absent_today": len(absent_today),
                         "approved_days": float(days["approved"]), "pending_days": float(days["pending"])})
