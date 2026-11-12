"""L'API des documents administratifs (/api/documents/).

GET  types/                          -> les types actifs (le formulaire)
GET  mine/                           -> mes demandes de document
POST mine/                           -> demander un document {"doc_type": id, "purpose": "Banque"}
GET  files/<request>/                -> le PDF (le collaborateur, ses RH, Admin RH, IT ; sinon 404)
GET  hr/?status=to_prepare|in_progress|ready|all -> les demandes du pôle (RH ; Admin RH et IT : les deux pôles)
POST hr/<request>/upload/            -> déposer le PDF signé (multipart "file")
Valider / refuser : Team approvals (le moteur). Annuler : /api/workflows/requests/<request>/cancel/.
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import IsHR
from employees.models import Employee
from employees.services import limited_to_own_pole, user_pole
from workflows import engine
from workflows.models import Request

from .models import DocumentRequest, DocumentType
from .serializers import DocumentRequestSerializer, DocumentTypeSerializer
from .services import request_document, upload


def run(action):
    """Les erreurs des services -> des réponses claires ({"doc_type": [...]} ou {"detail": "..."})."""
    try:
        return action()
    except DjangoValidationError as error:
        raise serializers.ValidationError(error.message_dict if hasattr(error, "error_dict") else {"detail": error.messages[0]})
    except DjangoPermissionDenied as error:
        raise PermissionDenied(str(error))


def documents():
    """Les demandes avec tout ce que le JSON lit, en peu de requêtes SQL."""
    return (DocumentRequest.objects
            .select_related("request", "doc_type", "employee__department__direction__entity__pole", "delivered_by")
            .prefetch_related("request__steps"))


class TypeViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = DocumentType.objects.filter(is_active=True)
    serializer_class = DocumentTypeSerializer


class MyDocumentViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = DocumentRequestSerializer

    def get_queryset(self):
        return documents().filter(employee__user=self.request.user)

    def create(self, request):
        # "employee" (facultatif) : un RH demande POUR un collaborateur de son pôle ; sinon, pour moi.
        employee_id = str(request.data.get("employee") or "")
        if employee_id:
            employee = Employee.objects.filter(pk=employee_id).first() if employee_id.isdigit() else None
        else:
            employee = Employee.objects.filter(user=request.user).first()
        if employee is None:
            raise NotFound("Aucun dossier RH n'est lié à ce compte." if not employee_id else "Collaborateur introuvable.")
        doc_type = DocumentType.objects.filter(pk=request.data.get("doc_type")).first()
        if doc_type is None:
            raise serializers.ValidationError({"doc_type": ["Choisissez un document."]})
        document = run(lambda: request_document(employee, doc_type, request.data.get("purpose", ""), by=request.user))
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk)).data, status=status.HTTP_201_CREATED)


class FileViewSet(viewsets.GenericViewSet):
    """GET files/<request>/ -> le PDF livré. Pour ceux que la demande concerne (le collaborateur, les RH de son pôle,
    Admin RH, IT : la même règle que l'historique) ; sinon 404, comme s'il n'existait pas."""

    lookup_field = "request"
    lookup_url_kwarg = "request_id"

    def get_queryset(self):
        return DocumentRequest.objects.filter(request__in=engine.requests_visible_to(self.request.user)).exclude(file="")

    def retrieve(self, request, request_id=None):
        document = self.get_object()
        return FileResponse(document.file.open("rb"), as_attachment=True, filename=document.file_name or "document.pdf")


class HrDocumentViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Les demandes de document du pôle (RH ; Admin RH et IT : les deux pôles), pour préparer et déposer."""

    serializer_class = DocumentRequestSerializer
    permission_classes = [IsHR]
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # multipart : le PDF est un fichier
    lookup_field = "request"
    lookup_url_kwarg = "request_id"

    FILTERS = {
        "to_prepare": {"request__status": Request.Status.APPROVED, "file": ""},
        "in_progress": {"request__status": Request.Status.IN_PROGRESS},
        "ready": {"request__status": Request.Status.APPROVED, "delivered_at__isnull": False},
    }

    def get_queryset(self):
        queryset = documents()
        user = self.request.user
        if limited_to_own_pole(user):
            pole = user_pole(user)
            queryset = queryset.filter(employee__department__direction__entity__pole=pole) if pole else queryset.none()
        if self.action == "list":
            wanted = self.request.query_params.get("status")
            queryset = queryset.filter(**self.FILTERS.get(wanted, {}))
            if wanted in ("to_prepare", "in_progress"):
                queryset = queryset.order_by("due_date", "id")  # à faire : le délai le plus proche d'abord
        return queryset

    @action(detail=True, methods=["post"])
    def upload(self, request, request_id=None):
        document = self.get_object()
        run(lambda: upload(document, request.user, request.FILES.get("file")))
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk)).data)
