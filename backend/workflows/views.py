from rest_framework import mixins, viewsets

from accounts.permissions import IsHRAdmin
from employees.models import Director, Pole

from .models import Workflow
from .serializers import DirectorSerializer, PoleDirectorSerializer, WorkflowSerializer


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
