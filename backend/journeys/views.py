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

from . import services
from .models import Departure, DepartureType, JourneySettings, JourneyTask, Kind, TaskTemplate
from .serializers import (DepartureSerializer, JourneySerializer, JourneySettingsSerializer, MyTaskSerializer,
                          TaskTemplateSerializer)


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
        departure = run(lambda: services.request_departure(
            employee, request.user, str(data.get("departure_type", "")), last_day, str(data.get("comment", "")),
            request.FILES.get("letter"), informed))
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
        })

    @action(detail=True)
    def letter(self, request, pk=None):
        departure = get_object_or_404(self.get_queryset(), pk=pk)
        if not departure.letter or not services.can_see_departure(request.user, departure):
            raise NotFound()
        return FileResponse(departure.letter.open("rb"), filename=departure.letter_name or "lettre.pdf")


class JourneySettingsView(APIView):
    """Les réglages des arrivées et départs (Admin RH + IT) : GET / PATCH {employee_can_request_departure, auto_block}."""

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
