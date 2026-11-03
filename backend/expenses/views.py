"""L'API des notes de frais (/api/expenses/).

GET  categories/                      -> les catégories actives (le formulaire)
GET  scales/                          -> le barème de chaque grade ; PATCH scales/<id>/ : Admin RH
GET  mine/                            -> mes notes de frais
POST mine/                            -> envoyer une note (multipart : title, lines = JSON, receipt_0, receipt_1...)
GET  mine/scale/                      -> MON barème (selon mon grade), pour les aides du formulaire
GET  claims/<request>/                -> une note (pour ceux que la demande concerne : moi, mon N+1, les RH...)
GET  claims/<request>/pdf/            -> son PDF, une fois validée (à imprimer pour les RH)
GET  lines/<id>/receipt/              -> le justificatif d'une dépense (mêmes droits que la note)
GET  hr/?status=to_reimburse|reimbursed|in_progress|all -> les notes du pôle (RH)
POST hr/<request>/reimburse/          -> la marquer remboursée (RH)
Annuler : /api/workflows/requests/<request>/cancel/ (le moteur, comme pour toutes les demandes).
"""
import json

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse, HttpResponse
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from accounts.permissions import IsHR, IsHRAdmin
from employees.models import Employee
from employees.services import limited_to_own_pole, user_pole
from workflows import engine
from workflows.models import Request

from .models import ExpenseCategory, ExpenseClaim, ExpenseLine, ExpenseScale
from .pdf import claim_pdf
from .serializers import CategorySerializer, ClaimSerializer, LineInputSerializer, ScaleSerializer
from .services import mark_reimbursed, submit_claim


def run(action):
    """Les erreurs des services -> des réponses claires. Une erreur PAR CHAMP / PAR LIGNE reste rangée
    ({"line_0": ["Plafond..."]}) : le formulaire affiche chaque message sous sa ligne."""
    try:
        return action()
    except DjangoValidationError as error:
        raise serializers.ValidationError(error.message_dict if hasattr(error, "error_dict") else {"detail": error.messages[0]})
    except DjangoPermissionDenied as error:
        raise PermissionDenied(str(error))


def claims():
    """Les notes avec tout ce que le JSON lit, en peu de requêtes SQL."""
    return (ExpenseClaim.objects
            .select_related("request", "employee__department__direction__entity__pole", "employee__grade", "reimbursed_by")
            .prefetch_related("lines__category", "request__steps__assignee"))


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ExpenseCategory.objects.filter(is_active=True)
    serializer_class = CategorySerializer


class ScaleViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Le barème : tout le monde le lit (page Notes de frais) ; seule Admin RH (et l'IT) change les montants."""

    queryset = ExpenseScale.objects.select_related("grade")
    serializer_class = ScaleSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_permissions(self):
        return super().get_permissions() if self.request.method in SAFE_METHODS else [IsHRAdmin()]


def my_employee(user):
    employee = Employee.objects.filter(user=user).select_related("grade").first()
    if employee is None:
        raise NotFound("Aucun dossier RH n'est lié à ce compte.")
    return employee


class MyClaimViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = ClaimSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # multipart : les justificatifs sont des fichiers

    def get_queryset(self):
        return claims().filter(employee__user=self.request.user)

    def create(self, request):
        employee = my_employee(request.user)
        # Les lignes arrivent en JSON (texte) dans le formulaire multipart ; chaque fichier à côté : receipt_<n°>.
        try:
            raw_lines = json.loads(request.data.get("lines") or "[]")
        except json.JSONDecodeError:
            raise serializers.ValidationError({"lines": ["Lignes illisibles."]})
        if not isinstance(raw_lines, list):
            raise serializers.ValidationError({"lines": ["Lignes illisibles."]})

        lines, errors = [], {}
        for index, raw in enumerate(raw_lines):
            data = LineInputSerializer(data=raw if isinstance(raw, dict) else {})
            if data.is_valid():
                lines.append({**data.validated_data, "receipt": request.FILES.get(f"receipt_{index}")})
            else:
                # Un champ mal rempli (ex. une date vide) : son message, sous sa ligne.
                errors[f"line_{index}"] = [f"{name} : {messages[0]}" for name, messages in data.errors.items()]
        if errors:
            raise serializers.ValidationError(errors)

        claim = run(lambda: submit_claim(employee, request.data.get("title"), lines))
        return Response(ClaimSerializer(claims().get(pk=claim.pk)).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def scale(self, request):
        """Mon grade et ses plafonds : {"grade": "Grade E — Employé" ou null, "scale": {...} ou null}.
        Toujours un objet JSON : Response(None) enverrait une réponse VIDE, que le navigateur ne sait pas lire
        (bug du 2026-11-03 : la page restait sur "Could not load" pour un compte sans grade)."""
        employee = my_employee(request.user)
        scale = ExpenseScale.objects.filter(grade=employee.grade).select_related("grade").first() if employee.grade_id else None
        return Response({"grade": str(employee.grade) if employee.grade_id else None,
                         "scale": ScaleSerializer(scale).data if scale else None})


class ClaimViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Une note, par le numéro de SA DEMANDE (/claims/<request>/), pour ceux que la demande concerne :
    le demandeur, ses valideurs, les RH du pôle, Admin RH, IT (la même règle que l'historique ; sinon 404)."""

    serializer_class = ClaimSerializer
    lookup_field = "request"
    lookup_url_kwarg = "request_id"  # pas "request" dans l'adresse : ce nom est déjà le 1er argument des méthodes

    def get_queryset(self):
        return claims().filter(request__in=engine.requests_visible_to(self.request.user))

    @action(detail=True, methods=["get"])
    def pdf(self, request, request_id=None):
        claim = self.get_object()
        if claim.request.status != Request.Status.APPROVED:
            raise serializers.ValidationError({"detail": "Le PDF est disponible après la validation de la note."})
        response = HttpResponse(claim_pdf(claim), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="note-de-frais-{claim.request_id}.pdf"'
        return response


class LineViewSet(viewsets.GenericViewSet):
    """Le justificatif d'une dépense : mêmes droits que la note (sinon 404, comme si elle n'existait pas)."""

    def get_queryset(self):
        return ExpenseLine.objects.filter(claim__request__in=engine.requests_visible_to(self.request.user))

    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        line = self.get_object()
        if not line.receipt:
            raise NotFound("Pas de justificatif pour cette dépense.")
        return FileResponse(line.receipt.open("rb"), as_attachment=False, filename=line.receipt_name or line.receipt.name)


class HrClaimViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Les notes de frais du pôle (RH ; Admin RH et IT : les deux pôles), pour les rembourser."""

    serializer_class = ClaimSerializer
    permission_classes = [IsHR]
    lookup_field = "request"
    lookup_url_kwarg = "request_id"

    FILTERS = {
        "to_reimburse": {"request__status": Request.Status.APPROVED, "reimbursed_at__isnull": True},
        "reimbursed": {"reimbursed_at__isnull": False},
        "in_progress": {"request__status": Request.Status.IN_PROGRESS},
    }

    def get_queryset(self):
        queryset = claims()
        user = self.request.user
        if limited_to_own_pole(user):
            pole = user_pole(user)
            queryset = queryset.filter(employee__department__direction__entity__pole=pole) if pole else queryset.none()
        if self.action == "list":
            queryset = queryset.filter(**self.FILTERS.get(self.request.query_params.get("status"), {}))
        return queryset

    @action(detail=True, methods=["post"])
    def reimburse(self, request, request_id=None):
        claim = self.get_object()
        run(lambda: mark_reimbursed(claim, request.user))
        return Response(ClaimSerializer(claims().get(pk=claim.pk)).data)
