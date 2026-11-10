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

from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

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
from .models import (
    AnnualRightChange, BalanceAdjustment, LeaveRecount, LeaveRequest, LeaveSettings, LeaveType, PublicHoliday,
)
from .serializers import (
    AbsenceSerializer, AdjustmentInputSerializer, AdjustmentSerializer, LeaveInputSerializer, LeaveRequestSerializer,
    LeaveTypeSerializer, PublicHolidaySerializer, RecountSerializer, RightChangeInputSerializer, RightChangeSerializer,
)
from .services import (
    add_adjustment, attach_document, can_manage_balance, can_open_document, cancel_leave, change_annual_right,
    preview_leave, record_leave, request_leave,
)


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

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """POST /api/leaves/mine/<id>/cancel/ {"reason": "..."} -> P1 step 5 : j'annule MON congé déjà accepté,
        avant son premier jour (un congé encore en cours s'annule par le moteur, comme avant)."""
        leave = self.get_object()  # seulement MES congés (sinon 404)
        run(lambda: cancel_leave(leave, request.user, request.data.get("reason", "")))
        return Response(LeaveRequestSerializer(self.get_queryset().get(pk=leave.pk)).data)

    @action(detail=False, methods=["get"], url_path="balance-changes", url_name="balance-changes")
    def balance_changes(self, request):
        """GET /api/leaves/mine/balance-changes/ -> ce que les RH ont changé dans MON solde, avec le motif :
        {"adjustments": [...], "right_changes": [...]} (la section "Balance changes" de ma page Congés)."""
        employee = self.employee()
        return Response({
            "adjustments": AdjustmentSerializer(employee.balance_adjustments.select_related("created_by"), many=True).data,
            "right_changes": RightChangeSerializer(employee.right_changes.select_related("changed_by"), many=True).data,
        })

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
        adjustments = BalanceAdjustment.objects.filter(employee=employee).select_related("created_by")
        return Response({
            **self.row(employee, settings, today),
            "base_right": float(employee.annual_leave_days),  # le droit de la fiche, depuis l'embauche
            "right_changes": RightChangeSerializer(changes, many=True).data,
            "adjustments": AdjustmentSerializer(adjustments, many=True).data,
            # Les boutons "Change" et "Add a correction" : RH du pôle / Admin RH, jamais pour soi-même.
            "can_manage": can_manage_balance(request.user, employee),
            "years": balance_by_year(employee, today),
            "leaves": LeaveRequestSerializer(leaves, many=True).data,
        })

    @action(detail=True, methods=["post"])
    def right(self, request, pk=None):
        """POST /api/leaves/balances/<employee>/right/ {"annual_days": 30, "effective_from": "2026-09-01",
        "reason": "Promotion manager"} -> P1 step 2 : le nouveau droit, à partir de cette date. Répond le panneau à jour."""
        employee = self.visible_employee(pk)
        data = RightChangeInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        run(lambda: change_annual_right(employee, user=request.user, **data.validated_data))
        return self.retrieve(request, pk=pk)

    @action(detail=True, methods=["post"])
    def adjustment(self, request, pk=None):
        """POST /api/leaves/balances/<employee>/adjustment/ {"days": -10, "date": "2025-12-31",
        "reason": "Congés 2025 pris avant l'application"} -> P1 step 3 : une correction du solde. Répond le panneau à jour."""
        employee = self.visible_employee(pk)
        data = AdjustmentInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        run(lambda: add_adjustment(employee, user=request.user, **data.validated_data))
        return self.retrieve(request, pk=pk)

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        """POST /api/leaves/balances/<employee>/leave/ {"leave_type", "start_date", "end_date", "starts_afternoon",
        "ends_noon", "reason"} -> P1 step 4b : les RH enregistrent un congé pour ce collaborateur (déjà accepté).
        Répond le panneau à jour."""
        employee = self.visible_employee(pk)
        data = LeaveInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)  # la forme (dates lisibles, année possible...)
        run(lambda: record_leave(employee, user=request.user, **data.validated_data))
        return self.retrieve(request, pk=pk)

    @action(detail=True, methods=["post"], url_path="cancel-leave", url_name="cancel-leave")
    def cancel_leave(self, request, pk=None):
        """POST /api/leaves/balances/<employee>/cancel-leave/ {"leave": 12, "reason": "..."} -> P1 step 5 :
        les RH annulent un congé accepté de ce collaborateur, avant son premier jour. Répond le panneau à jour."""
        employee = self.visible_employee(pk)
        leave_id = str(request.data.get("leave", ""))
        leave = LeaveRequest.objects.filter(pk=leave_id, employee=employee).select_related("request").first() if leave_id.isdigit() else None
        if leave is None:
            raise NotFound("Congé introuvable.")
        run(lambda: cancel_leave(leave, request.user, request.data.get("reason", "")))  # la fonction du service
        return self.retrieve(request, pk=pk)

    def visible_employee(self, pk):
        """Le collaborateur, s'il est dans le pôle de ce RH ; sinon 404 (comme s'il n'existait pas)."""
        employee = Employee.objects.filter(pk=pk, pk__in=self.visible_ids()).first() if str(pk).isdigit() else None
        if employee is None:
            raise NotFound("Collaborateur introuvable.")
        return employee

    def visible_ids(self):
        """Les collaborateurs que ce RH peut ouvrir : son pôle (Admin RH, IT : tous), "Sorti" compris."""
        user, employees = self.request.user, Employee.objects.all()
        if limited_to_own_pole(user):
            pole = user_pole(user)
            employees = employees.filter(department__direction__entity__pole=pole) if pole else employees.none()
        return employees.values("pk")


class LeaveDocumentView(APIView):
    """P2 step 4 : le justificatif d'un congé (certificat médical...).
    GET  /api/leaves/documents/<leave>/ -> le fichier (le collaborateur et les RH de son pôle ; PAS le N+1 : une donnée
                                          de santé ; les autres : 404, comme si le congé n'existait pas)
    POST /api/leaves/documents/<leave>/ -> multipart {"document": fichier} : joindre ou remplacer (avec la demande,
                                          ou plus tard). Répond le congé à jour."""

    parser_classes = [MultiPartParser]

    def leave(self, request, leave_id):
        leave = LeaveRequest.objects.select_related("employee", "leave_type", "request").filter(pk=leave_id).first()
        if leave is None or not can_open_document(request.user, leave):
            raise NotFound("Congé introuvable.")
        return leave

    def get(self, request, leave_id):
        leave = self.leave(request, leave_id)
        if not leave.document:
            raise NotFound("Pas de justificatif pour ce congé.")
        return FileResponse(leave.document.open("rb"), as_attachment=False, filename=leave.document_name or leave.document.name)

    def post(self, request, leave_id):
        leave = self.leave(request, leave_id)
        file = request.FILES.get("document")
        if file is None:
            raise ValidationError({"document": ["Choisissez un fichier (PDF, JPG ou PNG)."]})
        run(lambda: attach_document(leave, file, request.user))
        return Response(LeaveRequestSerializer(LeaveRequest.objects.prefetch_related("recounts").get(pk=leave.pk)).data)


TEAM_CALENDAR_MAX_DAYS = 31  # un congé plus long : le calendrier montre son premier mois


def team_grid(team, start, end, this_leave=None):
    """La grille "qui est absent quand" d'une équipe, entre deux dates (P2 steps 2 et 2b, les deux calendriers) :
    - days : chaque jour, "off" s'il n'est pas travaillé (dimanche, férié : personne n'y manque) ;
    - people : chaque personne et ses absences, jour par jour : THIS (le congé qu'on valide), APPROVED, IN_PROGRESS,
      + half (une demi-journée) ;
    - busy : les jours travaillés où PLUS DE LA MOITIÉ de l'équipe serait absente (un avertissement seulement).
    Vie privée (standard) : seulement "absent", JAMAIS le type de congé."""
    team = list(team)
    holidays = dict(PublicHoliday.objects.filter(date__range=(start, end), is_active=True).values_list("date", "name"))
    days, day = [], start
    while day <= end:
        days.append({"date": day, "off": day.weekday() == 6 or day in holidays, "holiday": holidays.get(day)})
        day += datetime.timedelta(days=1)

    leaves = (LeaveRequest.objects.filter(employee__in=team, request__status__in=LeaveRequest.ACTIVE,
                                          start_date__lte=end, end_date__gte=start).select_related("request"))
    if this_leave is not None:
        leaves = leaves.exclude(pk=this_leave.pk)
    leaves = [*([this_leave] if this_leave is not None else []), *leaves]
    people = []
    for member in team:
        cells = {}
        for item in (leave for leave in leaves if leave.employee_id == member.pk):
            state = "THIS" if this_leave is not None and item.pk == this_leave.pk else item.request.status
            for value in days:
                if not value["off"] and item.start_date <= value["date"] <= item.end_date:
                    half = (value["date"] == item.start_date and item.starts_afternoon) or (value["date"] == item.end_date and item.ends_noon)
                    cells[value["date"].isoformat()] = {"state": state, "half": half}
        people.append({"id": member.pk, "name": person(member), "cells": cells})

    size = len(people)
    busy = []
    for value in days:
        if value["off"]:
            continue
        away = sum(1 for member in people if value["date"].isoformat() in member["cells"])
        if size > 1 and away * 2 > size:
            busy.append({"date": value["date"], "away": away, "team": size})
    return days, people, busy


def my_team(employee):
    """P2 step 2b : MON équipe = les personnes dont JE suis le N+1 (la même règle que le moteur des validations :
    le responsable du service, sinon de la direction, sinon le DG). Cherchées là où je peux être leur N+1 :
    les services et la direction que je dirige, ou tout le pôle si je suis le DG. Les "Sorti" ne comptent pas."""
    if employee is None:
        return []
    places = Q(department__head=employee) | Q(department__direction__head=employee)
    if employee.pole.director_id == employee.pk:
        places |= Q(department__direction__entity__pole=employee.pole)
    candidates = (Employee.objects.filter(places).exclude(pk=employee.pk).exclude(status=Employee.Status.LEFT)
                  .select_related("department__direction__entity__pole", "department__head", "department__direction__head")
                  .order_by("last_name", "first_name").distinct())
    return [member for member in candidates if member.n_plus_1 and member.n_plus_1.pk == employee.pk]


class TeamMonthView(APIView):
    """P2 step 2b : la page "Team calendar" (managers) : MON équipe sur un mois, à tout moment (pas seulement quand
    une demande arrive) : pour prévoir (qui est absent ? quel jour pour une réunion ?).
    GET /api/leaves/team-calendar/month/?month=2026-11 (par défaut : ce mois-ci). Moi en premier, puis mon équipe.
    Vie privée : seulement "absent", jamais le type de congé. Pas d'équipe : une liste vide (la page le dit)."""

    def get(self, request):
        text = request.query_params.get("month", "")
        try:
            first = datetime.date(int(text[:4]), int(text[5:7]), 1) if len(text) == 7 else timezone.localdate().replace(day=1)
        except ValueError:
            raise ValidationError({"detail": "month : AAAA-MM."})
        last = (first + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)
        me = Employee.objects.filter(user=request.user).select_related("department__direction__entity__pole").first()
        team = my_team(me)
        days, people, busy = team_grid([me, *team] if team else [], first, last)
        if people:
            people[0]["is_me"] = True
        return Response({"month": first.strftime("%Y-%m"), "start": first, "end": last, "team_size": len(team),
                         "days": days, "people": people, "busy": busy})


class TeamCalendarView(APIView):
    """P2 step 2 : le calendrier de l'équipe, pour le valideur d'un congé (Team approvals).
    GET /api/leaves/team-calendar/?request=12 -> pour les jours de CE congé : chaque personne du service du
    demandeur, et qui est absent chaque jour (accepté, ou en attente), + les jours où plus de la moitié de
    l'équipe serait absente (un avertissement : le valideur décide quand même).
    Vie privée (standard) : seulement "absent", JAMAIS le type de congé (une maladie ne regarde pas l'équipe).
    Mêmes droits que l'historique de la demande (sinon 404)."""

    def get(self, request):
        request_id = request.query_params.get("request", "")
        leave = (LeaveRequest.objects.filter(request=int(request_id), request__in=engine.requests_visible_to(request.user))
                 .select_related("employee__department").first()) if request_id.isdigit() else None
        if leave is None:
            raise NotFound("Congé introuvable.")
        start = leave.start_date
        end = min(leave.end_date, start + datetime.timedelta(days=TEAM_CALENDAR_MAX_DAYS - 1))
        team = (Employee.objects.filter(department=leave.employee.department).exclude(status=Employee.Status.LEFT)
                .order_by("last_name", "first_name"))
        days, people, busy = team_grid(team, start, end, this_leave=leave)
        for member in people:
            member["is_requester"] = member["id"] == leave.employee_id
        return Response({"department": leave.employee.department.name, "start": start, "end": end,
                         # P2 step 4 : le N+1 voit seulement si le justificatif est demandé et reçu (pas le fichier).
                         "document": {"required": leave.document_required, "received": bool(leave.document)},
                         "cut": end < leave.end_date, "days": days, "people": people, "busy": busy})


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
                                                               leave.ends_noon, leave.leave_type.in_calendar_days)
                            if start <= day <= end)
            approved = leave.request.status == Request.Status.APPROVED
            days["approved" if approved else "pending"] += in_period
            people.add(leave.employee_id)
            if approved and leave.start_date <= today <= leave.end_date:
                absent_today.add(leave.employee_id)
        return Response({"people": len(people), "absent_today": len(absent_today),
                         "approved_days": float(days["approved"]), "pending_days": float(days["pending"])})
