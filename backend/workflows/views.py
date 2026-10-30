from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.permissions import IsHRAdmin
from employees.models import Director, Pole

from . import engine
from .models import Request, Workflow
from .serializers import (
    ApprovalSerializer, DecisionSerializer, DirectorSerializer, PoleDirectorSerializer, RequestSerializer,
    WorkflowSerializer,
)


class WorkflowViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Les circuits, pour l'écran "Workflows" (Admin RH et IT seulement).

    GET   /api/workflows/      -> les circuits et leurs étapes
    PATCH /api/workflows/<id>/ -> renommer, désactiver, ou changer les étapes
    Pas de POST (les types de demande viennent du code) ni de DELETE (jamais supprimé)."""

    # prefetch_related : les étapes de TOUS les circuits en une seule requête SQL (pas une par circuit).
    queryset = Workflow.objects.prefetch_related("steps")
    serializer_class = WorkflowSerializer
    permission_classes = [IsHRAdmin]
    http_method_names = ["get", "patch", "head", "options"]


class DirectorViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Les DG (actifs ET désactivés : Admin RH doit pouvoir en réactiver un).

    GET / POST /api/workflows/directors/      -> la liste, ajouter un DG
    PATCH      /api/workflows/directors/<id>/ -> renommer, changer l'e-mail, désactiver
    Pas de DELETE (jamais supprimé)."""

    queryset = Director.objects.all()
    serializer_class = DirectorSerializer
    permission_classes = [IsHRAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]


class PoleDirectorViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Le DG de chaque pôle.

    GET   /api/workflows/poles/      -> [{"id": 1, "name": "SBD", "director": 1}, ...]
    PATCH /api/workflows/poles/<id>/ -> {"director": 2} (ou null : pas de DG)"""

    queryset = Pole.objects.all()
    serializer_class = PoleDirectorSerializer
    permission_classes = [IsHRAdmin]
    http_method_names = ["get", "patch", "head", "options"]


# --- Les demandes (step 6a) : ouvertes à tous les rôles, chacun voit SES demandes -----------

def run(action):
    """Lance une action du moteur et transforme ses erreurs en réponses claires pour le frontend.
    Le moteur lève les erreurs de Django ; sans cette traduction, DRF répondrait 500 (ou un 403 sans le message)."""
    try:
        return action()
    except DjangoValidationError as error:   # une règle refusée : "Un commentaire est obligatoire pour refuser."
        raise serializers.ValidationError({"detail": error.messages[0]})
    except DjangoPermissionDenied as error:  # pas le droit : "Seul le demandeur peut annuler sa demande."
        raise PermissionDenied(str(error))


def with_steps(requests):
    """Les demandes avec leur circuit, en peu de requêtes SQL (sinon une requête par étape et par nom)."""
    return requests.select_related("workflow", "requester").prefetch_related(
        "steps__assignee", "steps__director", "steps__decided_by")


def answer(request_pk):
    """La demande après une action, relue avec ses étapes à jour : la page remplace sa version."""
    return Response(RequestSerializer(with_steps(Request.objects).get(pk=request_pk)).data)


class MyRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """MES demandes (page "My requests").

    GET  /api/workflows/requests/             -> mes demandes, la plus récente d'abord
    GET  /api/workflows/requests/<id>/        -> une de mes demandes (celle d'un autre : 404)
    POST /api/workflows/requests/<id>/cancel/ -> l'annuler (tant qu'elle est en cours)"""

    serializer_class = RequestSerializer

    def get_queryset(self):
        return with_steps(Request.objects.filter(requester__user=self.request.user))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        demand = self.get_object()
        run(lambda: engine.cancel(demand, request.user))
        return answer(demand.pk)


class ApprovalViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Ce qui attend MA réponse (page "Team approvals"). L'id dans l'adresse est celui de l'ÉTAPE.

    GET  /api/workflows/approvals/              -> les étapes qui m'attendent, la plus ancienne d'abord
    POST /api/workflows/approvals/<id>/approve/ -> {"comment": "..."} (facultatif)
    POST /api/workflows/approvals/<id>/reject/  -> {"comment": "..."} (obligatoire)"""

    serializer_class = ApprovalSerializer

    def get_queryset(self):
        # Seulement les étapes qui m'attendent : une autre étape -> 404, même avec son numéro.
        return (
            engine.steps_waiting_for(self.request.user)
            .select_related("request__workflow", "request__requester")
            .prefetch_related("request__steps__assignee", "request__steps__director", "request__steps__decided_by")
            .order_by("request__created_at")  # celle qui attend depuis le plus longtemps d'abord
        )

    def decide(self, decision):
        """approve ou reject : lit le commentaire, appelle le moteur, renvoie la demande à jour."""
        step = self.get_object()
        data = DecisionSerializer(data=self.request.data)
        data.is_valid(raise_exception=True)
        run(lambda: decision(step, self.request.user, data.validated_data["comment"]))
        return answer(step.request_id)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self.decide(engine.approve)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self.decide(engine.reject)
