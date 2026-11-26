"""L'API des arrivées et départs (incluse sous /api/journeys/ dans core/urls.py).

- tasks/      : MES tâches (tout le monde) ; tasks/<id>/done/ et reopen/.
- journeys/   : les parcours de mon pôle (RH ; Admin RH et IT : les deux) ; POST = commencer ; <id>/cancel/.
- templates/  : le modèle des tâches (lecture : RH ; ajout / modification : Admin RH).
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Prefetch, Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsHR, IsHRAdmin
from employees.models import Employee

from django.utils import timezone

from workflows.serializers import name_of

from . import exit_summary, notice, services
from .models import (Departure, DepartureType, ExitQuestion, JourneySettings, JourneyTask, Kind, NoticeGroup, NoticeRule,
                     TaskTemplate)
from .serializers import (DepartureSerializer, ExitQuestionSerializer, JourneySerializer, JourneySettingsSerializer,
                          MyTaskSerializer, NoticeRuleSerializer, TaskTemplateSerializer)


def run(action):
    """Les erreurs des services -> des réponses claires ({"detail": "..."})."""
    try:
        return action()
    except DjangoValidationError as error:
        raise serializers.ValidationError(error.message_dict if hasattr(error, "error_dict") else {"detail": error.messages[0]})
    except DjangoPermissionDenied as error:
        raise PermissionDenied(str(error))


class MyTaskViewSet(viewsets.ReadOnlyModelViewSet):
    """MES tâches (tout le monde) : ?status=open (par défaut) | done | all."""

    serializer_class = MyTaskSerializer

    def get_queryset(self):
        tasks = services.tasks_of(self.request.user)
        status = self.request.query_params.get("status", "open")
        if status == "open":
            tasks = tasks.filter(done_at__isnull=True)
        elif status == "done":
            tasks = tasks.filter(done_at__isnull=False).order_by("-done_at")[:100]  # les 100 dernières faites
        return tasks

    @staticmethod
    def handled(user, pk):
        """La tâche, si je peux la cocher : la mienne, ou (RH du pôle) n'importe laquelle de mon pôle. Sinon 404."""
        task = JourneyTask.objects.select_related("journey__employee__department__direction__entity__pole", "person").filter(pk=pk).first()
        if task is None or not services.can_handle(user, task):
            raise NotFound()
        return task

    @action(detail=True, methods=["post"])
    def done(self, request, pk=None):
        """Coche "Fait" : {detail, comment} (optionnels)."""
        task = self.handled(request.user, pk)
        task = run(lambda: services.complete(task, request.user, str(request.data.get("detail", "")), str(request.data.get("comment", ""))))
        return Response(MyTaskSerializer(task).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        task = self.handled(request.user, pk)
        return Response(MyTaskSerializer(run(lambda: services.reopen(task, request.user))).data)


class JourneyViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Les parcours que je suis : les RH (leur pôle ; Admin RH et IT : les deux), un manager (son équipe, en lecture :
    il coche seulement ses tâches). ?status=open (par défaut) | done | cancelled | all ; ?kind=ARRIVAL|DEPARTURE ;
    ?search=mots (nom, prénom ou matricule). Commencer / annuler : les RH (vérifié par les services)."""

    serializer_class = JourneySerializer

    def get_queryset(self):
        params = self.request.query_params
        journeys = (services.visible_journeys(self.request.user)
                    .select_related("created_by", "cancelled_by", "employee__department__direction",
                                    "departure__request__initiated_by", "departure__employee__position",
                                    "departure__employee__department__direction")
                    .prefetch_related(Prefetch("tasks", queryset=JourneyTask.objects.select_related("person", "done_by")),
                                      "departure__informed")
                    .annotate(waiting=Count("tasks", filter=Q(tasks__done_at__isnull=True))))
        if self.action != "list":
            return journeys
        status = params.get("status", "open")
        if status == "open":
            journeys = journeys.filter(cancelled_at__isnull=True, waiting__gt=0)
        elif status == "done":
            journeys = journeys.filter(cancelled_at__isnull=True, waiting=0)
        elif status == "cancelled":
            journeys = journeys.filter(cancelled_at__isnull=False)
        if params.get("kind") in Kind.values:
            journeys = journeys.filter(kind=params["kind"])
        for word in params.get("search", "").split():
            journeys = journeys.filter(Q(employee__last_name__icontains=word) | Q(employee__first_name__icontains=word)
                                       | Q(employee__u_number__icontains=word))
        # En cours : le plus proche d'abord (qui arrive demain avant qui arrive dans un mois) ; sinon le plus récent.
        return journeys.order_by("day", "id") if status == "open" else journeys.order_by("-day", "-id")

    def create(self, request, *args, **kwargs):
        """Commencer un parcours : {employee, kind} (+ {day} pour un départ). L'arrivée prend la date d'embauche."""
        employee = get_object_or_404(Employee, pk=request.data.get("employee") or 0)
        kind = request.data.get("kind", Kind.ARRIVAL)
        if kind not in Kind.values:
            raise serializers.ValidationError({"kind": "Parcours inconnu."})
        day = serializers.DateField().to_internal_value(request.data["day"]) if request.data.get("day") else None
        journey = run(lambda: services.start(employee, kind, request.user, day=day))
        return Response(self.get_serializer(self.get_queryset().get(pk=journey.pk)).data, status=201)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Annuler : {reason} (obligatoire)."""
        journey = run(lambda: services.cancel(self.get_object(), request.user, str(request.data.get("reason", ""))))
        return Response(self.get_serializer(self.get_queryset().get(pk=journey.pk)).data)


class DepartureViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Les demandes de départ. GET ?status=pending (en attente des RH, par défaut) | all : les RH (leur pôle), un manager
    (son équipe et ce qu'il a saisi), la personne elle-même. POST (multipart) : {employee, departure_type, last_day,
    comment, informed (ids), letter (fichier)}. options/ : ce que le formulaire propose ; <id>/letter/ : la lettre."""

    serializer_class = DepartureSerializer

    def get_queryset(self):
        user = self.request.user
        departures = (Departure.objects.select_related("request__initiated_by", "employee__position",
                                                       "employee__department__direction__entity__pole")
                      .prefetch_related("informed"))
        if not services.sees_both_poles(user):
            mine = Q(request__initiated_by=user) | Q(employee__user=user) | Q(employee__in=[m.pk for m in services.team_of(user)])
            if services.is_hr(user):
                pole = services.user_pole(user)
                mine |= Q(employee__department__direction__entity__pole=pole.pk) if pole else Q()
            departures = departures.filter(mine)
        if self.action == "list" and self.request.query_params.get("status", "pending") == "pending":
            departures = departures.filter(request__status="IN_PROGRESS")
        return departures

    def create(self, request, *args, **kwargs):
        data = request.data
        employee = get_object_or_404(Employee, pk=data.get("employee") or 0)
        last_day = serializers.DateField().to_internal_value(data["last_day"]) if data.get("last_day") else None
        ids = data.getlist("informed") if hasattr(data, "getlist") else data.get("informed", [])
        informed = list(Employee.objects.filter(pk__in=[int(i) for i in ids if str(i).isdigit()]).exclude(status=Employee.Status.LEFT))
        serious = str(data.get("serious_misconduct", "")).lower() in ("1", "true", "yes", "on")  # faute grave (licenciement)
        departure = run(lambda: services.request_departure(
            employee, request.user, str(data.get("departure_type", "")), last_day, str(data.get("comment", "")),
            request.FILES.get("letter"), informed, serious_misconduct=serious))
        return Response(self.get_serializer(self.get_queryset().get(pk=departure.pk)).data, status=201)

    @action(detail=False)
    def options(self, request):
        """Le formulaire "New departure" : les types, MON équipe (un manager), et si je peux demander mon propre départ."""
        me = Employee.objects.filter(user=request.user).first()
        team = [{"id": m.pk, "first_name": m.first_name, "last_name": m.last_name.title(), "position": m.position.name,
                 "department": m.department.name} for m in services.team_of(request.user)]
        return Response({
            "types": [{"id": value, "name": label} for value, label in DepartureType.choices],
            "team": team,
            "is_hr": services.is_hr(request.user),
            "can_request_own": services.can_request_own_departure(request.user),
            "me": me.pk if me else None,
            "letter_required": JourneySettings.load().letter_required,  # démission : la lettre jointe (réglage)
        })

    @action(detail=False, url_path="notice-preview")
    def notice_preview(self, request):
        """Le formulaire (2026-11-25) : le préavis légal de CE collaborateur pour CE type, si la demande part aujourd'hui.
        ?employee=<id>&type=<code>. Seulement pour qui peut déclarer ce départ (sinon 404)."""
        employee = get_object_or_404(Employee, pk=request.query_params.get("employee") or 0)
        if not services.can_request_departure(request.user, employee):
            raise NotFound()
        kind = request.query_params.get("type", "")
        serious = kind == DepartureType.DISMISSAL and request.query_params.get("serious") == "1"  # faute grave : rien
        result = None if serious else notice.compute(employee, kind, timezone.localdate())
        if result is None:
            return Response({"applies": False})
        return Response({"applies": True, **result, "group_label": NoticeGroup(result["group"]).label})

    @action(detail=False, url_path="my-notice")
    def my_notice(self, request):
        """MON préavis (2026-11-25, transparence : l'employé connaît ses règles AVANT de décider) : si je démissionnais
        aujourd'hui. Pour "My Profile" et "My departure", tout le monde (même sans le droit de demander son départ).
        Pas de fiche (compte IT) ou déjà sorti : 404."""
        me = Employee.objects.filter(user=request.user).exclude(status=Employee.Status.LEFT).first()
        if me is None:
            raise NotFound()
        result = notice.compute(me, DepartureType.RESIGNATION, timezone.localdate())
        if result is None:
            return Response({"applies": False})
        return Response({"applies": True, **result, "group_label": NoticeGroup(result["group"]).label})

    @action(detail=True, methods=["post"], url_path="notice")
    def decide_notice(self, request, pk=None):
        """Les RH décident du préavis : {status, start?} (start = corriger le début, ex. la date de la lettre)."""
        departure = get_object_or_404(Departure.objects.select_related("employee", "request"), pk=pk)
        if not services.can_see_departure(request.user, departure):
            raise NotFound()
        start = serializers.DateField().to_internal_value(request.data["start"]) if request.data.get("start") else None
        departure = run(lambda: notice.decide(departure, request.user, str(request.data.get("status", "")), start))
        return Response(self.get_serializer(departure).data)

    @action(detail=True)
    def payroll(self, request, pk=None):
        """Ce que la PAIE et la CNSS doivent savoir (2026-11-25) : les congés à payer au dernier jour (+ les congés après
        le dernier jour), les jours de préavis à retenir, l'indemnité de licenciement en heures, les données CNSS.
        Seulement les RH de son pôle (Admin RH, IT) : des éléments de paie. Les autres : 404."""
        departure = get_object_or_404(Departure.objects.select_related("employee", "request"), pk=pk)
        # Éteint par Admin RH (2026-11-26 : l'entreprise le fait autrement) : le bloc disparaît du panneau.
        if not services.is_hr_of(request.user, departure.employee) or not JourneySettings.load().show_payroll:
            raise NotFound()
        return Response(exit_summary.payroll(departure))

    @action(detail=False, url_path="payroll-preview")
    def payroll_preview(self, request):
        """L'aperçu "For payroll" AVANT d'enregistrer un départ (2026-11-26, standard "impact preview" de Workday / SAP) :
        ?employee=&type=&last_day=AAAA-MM-JJ&serious=1. Le même calcul que le panneau, sur un départ PAS enregistré
        (rien n'est sauvé). Ex. un jour de plus peut faire passer l'indemnité de 184 h à 192 h : les RH le voient avant.
        Seulement les RH de son pôle, et seulement si Admin RH n'a pas éteint le bloc "payroll" ; sinon 404."""
        employee = get_object_or_404(Employee, pk=request.query_params.get("employee") or 0)
        if not services.is_hr_of(request.user, employee) or not JourneySettings.load().show_payroll:
            raise NotFound()
        try:
            last_day = serializers.DateField().to_internal_value(request.query_params.get("last_day", ""))
        except serializers.ValidationError:
            raise NotFound()  # dernier jour pas encore complet dans le formulaire : rien à montrer
        kind = request.query_params.get("type", "")
        serious = kind == DepartureType.DISMISSAL and request.query_params.get("serious") == "1"
        # Un départ "en mémoire" (jamais .save()) : le préavis pris comme si la demande partait aujourd'hui.
        draft = notice.apply(Departure(employee=employee, departure_type=kind, last_day=last_day, serious_misconduct=serious))
        return Response(exit_summary.payroll(draft))

    @action(detail=True, methods=["post"], url_path="letter-original")
    def letter_original(self, request, pk=None):
        """Les RH : {received: true / false} = l'original papier de la lettre (signée, légalisée, art. 34) est arrivé."""
        departure = get_object_or_404(Departure.objects.select_related("employee", "request"), pk=pk)
        if not services.can_see_departure(request.user, departure):
            raise NotFound()
        received = request.data.get("received") in (True, "true", "1", 1)
        departure = run(lambda: services.mark_letter_original(departure, request.user, received))
        return Response(self.get_serializer(departure).data)

    @action(detail=True, methods=["get", "post"], url_path="exit-interview")
    def exit_interview(self, request, pk=None):
        """L'entretien de sortie (CONFIDENTIEL : le collaborateur et les RH de son pôle ; le manager : 404).
        GET : les questions, les réponses, qui a rempli ; POST {answers: {id_question: réponse}}."""
        departure = get_object_or_404(Departure.objects.select_related("employee", "request", "journey"), pk=pk)
        if not services.can_see_exit_interview(request.user, departure):
            raise NotFound()
        if request.method == "POST":
            run(lambda: services.save_exit_interview(departure, request.user, request.data.get("answers") or {}))
            departure.refresh_from_db()
        interview = getattr(departure, "exit_interview", None)
        open_ = departure.request.status == "APPROVED" and not (departure.journey and departure.journey.cancelled_at)
        return Response({
            "questions": services.exit_questions(departure),
            "answers": interview.answers if interview else {},
            "filled_by_name": name_of(interview.filled_by) if interview and interview.filled_by_id else None,
            "filled_at": interview.filled_at if interview else None,
            "open": open_,
            "can_fill": open_ and services.can_fill_exit_interview(request.user, departure),  # RH : pas les réponses du collaborateur
        })

    @action(detail=False, url_path=r"request/(?P<request_id>\d+)")
    def by_request(self, request, request_id=None):
        """Le départ d'une demande (Team approvals : la carte "Departure" montre le type, le dernier jour, la lettre...
        avant de valider). Mêmes droits que l'historique de la demande ; les autres : 404."""
        departure = get_object_or_404(Departure.objects.select_related(
            "request__initiated_by", "employee__position", "employee__department__direction__entity__pole"
        ).prefetch_related("informed"), request_id=request_id)
        if not services.can_see_departure(request.user, departure):
            raise NotFound()
        return Response(self.get_serializer(departure).data)

    @action(detail=True)
    def letter(self, request, pk=None):
        # Lu par l'id (pas get_queryset) : un valideur du circuit ou un délégué n'est pas dans la liste, mais il voit
        # la lettre de la demande qu'il doit traiter (can_see_departure).
        departure = get_object_or_404(Departure.objects.select_related("employee", "request"), pk=pk)
        if not departure.letter or not services.can_see_departure(request.user, departure):
            raise NotFound()
        # Ouverte dans le navigateur (View) ; le bouton "Download" l'enregistre (côté page).
        return FileResponse(departure.letter.open("rb"), filename=departure.letter_name or "lettre.pdf")


class JourneySettingsView(APIView):
    """Les réglages des arrivées et départs (Admin RH + IT) : GET / PATCH {employee_can_request_departure, auto_block,
    notice_types, executive_categories}."""

    permission_classes = [IsHRAdmin]

    def get(self, request):
        return Response(JourneySettingsSerializer(JourneySettings.load()).data)

    def patch(self, request):
        current = JourneySettings.load()
        data = JourneySettingsSerializer(current, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        data.save(updated_by=request.user)
        return Response(data.data)


class TaskTemplateViewSet(viewsets.ModelViewSet):
    """Le modèle des tâches (Reference lists -> Arrivées et départs). Lire : RH ; ajouter / modifier : Admin RH.
    Jamais supprimer : décocher "Actif"."""

    serializer_class = TaskTemplateSerializer
    queryset = TaskTemplate.objects.select_related("person")
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        return [IsHR()] if self.request.method in SAFE_METHODS else [IsHRAdmin()]

    def get_queryset(self):
        templates = super().get_queryset()
        kind = self.request.query_params.get("kind")
        return templates.filter(kind=kind) if kind in Kind.values else templates


class ExitQuestionViewSet(viewsets.ModelViewSet):
    """Les questions de l'entretien de sortie (Réglages -> Exit interview, Admin RH + IT) : lire, ajouter, modifier.
    Jamais supprimer : décocher "Active" (les entretiens passés gardent leur copie des questions)."""

    serializer_class = ExitQuestionSerializer
    queryset = ExitQuestion.objects.all()
    permission_classes = [IsHRAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]


class NoticeRuleViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """La grille du préavis (Réglages des arrivées et départs -> Notice period, Admin RH + IT) : GET la liste,
    PATCH <id> {amount, unit}. Les 6 lignes sont fixes (2 groupes x 3 anciennetés) : ni ajout, ni suppression.
    Une demande déjà faite garde SA photo : changer la grille ne touche que les prochaines."""

    serializer_class = NoticeRuleSerializer
    queryset = NoticeRule.objects.all()
    permission_classes = [IsHRAdmin]
    http_method_names = ["get", "patch", "head", "options"]
