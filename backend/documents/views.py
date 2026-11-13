"""L'API des documents administratifs (/api/documents/).

GET  types/                          -> les types actifs (le formulaire)
GET  mine/                           -> mes demandes de document
POST mine/                           -> demander un document {"doc_type": id, "purpose": "Banque", "format": "PDF|ORIGINAL|BOTH"}
GET  requests/<request>/             -> le document d'une demande (historique, Team approvals ; mêmes droits)
GET  files/<request>/                -> le PDF (le collaborateur, ses RH, Admin RH, IT ; sinon 404)
GET  hr/?status=to_prepare|in_progress|ready|all -> les demandes du pôle (RH ; Admin RH et IT : les deux pôles)
POST hr/<request>/upload/            -> déposer le PDF signé (multipart "file")
Valider / refuser : Team approvals (le moteur). Annuler : /api/workflows/requests/<request>/cancel/.
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse, HttpResponse
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import IsHR, IsHRAdmin
from employees.models import Employee, Pole
from employees.services import limited_to_own_pole, user_pole
from workflows import engine
from workflows.models import Request

from .models import DocumentRequest, DocumentSignatory, DocumentType
from .pdf import work_certificate
from .serializers import DocumentRequestSerializer, DocumentTypeSerializer, SignatorySerializer
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
        document = run(lambda: request_document(employee, doc_type, request.data.get("purpose", ""), by=request.user,
                                                format=request.data.get("format") or DocumentRequest.Format.PDF))
        data = DocumentRequestSerializer(documents().get(pk=document.pk), context={"request": request}).data
        return Response(data, status=status.HTTP_201_CREATED)


class SignatoryViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Qui signe les documents générés et COMMENT, par pôle (Admin RH et IT).

    GET   signatories/                       -> un réglage par pôle
    PATCH signatories/<id>/                  -> multipart : name, title, city, mode, signature / stamp (fichiers),
                                                remove_signature / remove_stamp = "true" pour les enlever
    GET   signatories/<id>/image/?kind=signature|stamp -> l'image (pour la voir dans la page)
    GET   signatories/<id>/preview/          -> une attestation d'EXEMPLE avec ce réglage (rien n'est enregistré)
    """

    serializer_class = SignatorySerializer
    permission_classes = [IsHRAdmin]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        for pole in Pole.objects.filter(is_active=True):  # un pôle ajouté plus tard a aussi son réglage
            DocumentSignatory.objects.get_or_create(pole=pole)
        return DocumentSignatory.objects.select_related("pole", "updated_by").order_by("pole__name")

    def partial_update(self, request, pk=None):
        signatory = self.get_object()
        data = SignatorySerializer(signatory, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        for field, value in data.validated_data.items():
            setattr(signatory, field, value)
        for kind in ("signature", "stamp"):
            if request.FILES.get(kind):
                setattr(signatory, kind, request.FILES[kind])
            elif str(request.data.get(f"remove_{kind}", "")).lower() == "true":
                setattr(signatory, kind, "")
        signatory.updated_by = request.user
        run(signatory.full_clean)  # les règles : PNG / JPG, 1 Mo, le mode "images" demande la signature
        signatory.save()
        return Response(SignatorySerializer(signatory).data)

    @action(detail=True)
    def image(self, request, pk=None):
        kind = request.query_params.get("kind")
        field = getattr(self.get_object(), kind) if kind in ("signature", "stamp") else None
        if not field:
            raise NotFound("Pas d'image.")
        return FileResponse(field.open("rb"))

    @action(detail=True)
    def preview(self, request, pk=None):
        """Une attestation de travail d'exemple, avec le premier collaborateur du pôle (Admin RH voit les deux pôles)."""
        signatory = self.get_object()
        employee = (Employee.objects.filter(department__direction__entity__pole=signatory.pole)
                    .select_related("department__direction__entity__pole", "position").order_by("id").first())
        if employee is None:
            raise NotFound("Aucun collaborateur dans ce pôle pour l'exemple.")
        example = DocumentRequest(employee=employee, reference="EXEMPLE")
        response = HttpResponse(work_certificate(example), content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="exemple-{signatory.pole.name}.pdf"'
        return response


class ByRequestViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """GET requests/<request>/ -> le document d'une demande (où il en est : à préparer, livré, la référence...), pour
    l'historique de la demande et Team approvals. Mêmes droits que l'historique ; sinon 404."""

    serializer_class = DocumentRequestSerializer
    lookup_field = "request"
    lookup_url_kwarg = "request_id"

    def get_queryset(self):
        return documents().filter(request__in=engine.requests_visible_to(self.request.user))


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
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk), context={"request": request}).data)
