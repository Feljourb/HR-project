"""L'API des documents administratifs (/api/documents/).

GET  types/                          -> les types actifs (le formulaire)
GET  mine/                           -> mes demandes de document
GET  mine/team-members/              -> mon équipe (je suis leur N+1) ; mine/for-team/ : ce que j'ai demandé pour elle
GET  mine/options/                   -> les formats proposés (réglage d'Admin RH)
GET / PATCH settings/                -> les réglages des documents (Admin RH) : formats, managers
POST mine/                           -> demander un ou plusieurs documents {"doc_types": [ids], "purpose": "Banque",
                                        "format": "PDF|ORIGINAL|BOTH"} (une demande, une validation) ; répond la liste
GET  requests/<request>/             -> LES documents d'une demande (historique, Team approvals ; mêmes droits)
Désormais <document> = le numéro du DOCUMENT (une demande peut en avoir plusieurs, 2026-11-17) :
GET  files/<document>/               -> le PDF (le collaborateur, ses RH, Admin RH, IT ; sinon 404)
GET  files/<document>/?draft=1       -> le brouillon sans signature, à imprimer (les RH seulement)
GET  hr/?status=to_prepare|in_progress|pickup|ready|all -> les demandes du pôle (RH ; Admin RH et IT : les deux pôles)
         &search=halima &type=<id> &from=2026-10-01 &to=2026-10-31 -> le nom / matricule, le type, la période
GET  hr/<document>/download/         -> ① le brouillon à imprimer (généré) ou le modèle Word du type (préparé par les RH)
GET/POST/DELETE types/<id>/model/    -> le modèle Word / PDF d'un type (GET : les RH ; POST / DELETE : Admin RH)
POST hr/<document>/upload/           -> déposer le PDF signé (multipart "file")
GET/POST hr/<document>/text/         -> le texte d'un document généré, à relire / modifier avant l'envoi (step 3)
POST hr/<document>/preview-text/     -> l'aperçu PDF avec ce texte (rien n'est enregistré)
POST hr/<document>/original-ready/   -> l'original papier signé attend au bureau RH (le collaborateur est prévenu)
POST hr/<document>/handed-over/      -> l'original est remis au collaborateur ({"to": "manager"} : à son manager)
Valider / refuser : Team approvals (le moteur). Annuler : /api/workflows/requests/<request>/cancel/.
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.http import FileResponse, HttpResponse
from django.utils.dateparse import parse_date
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsHR, IsHRAdmin
from employees.models import Employee, Pole
from employees.services import limited_to_own_pole, user_pole
from leaves.views import my_team
from workflows import engine
from workflows.models import Request

from .models import DocumentRequest, DocumentSettings, DocumentSignatory, DocumentType
from .pdf import TEMPLATES, work_certificate
from .serializers import DocumentRequestSerializer, DocumentSettingsSerializer, DocumentTypeSerializer, SignatorySerializer
from .services import (
    MAX_TEXT, auto_signed, can_prepare, draft_bytes, mark_handed_over, mark_original_ready, request_documents, save_text,
    set_model, text_of, upload,
)


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
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # le modèle est un fichier

    def get_queryset(self):
        # Le modèle d'un type désactivé reste gérable par Admin RH (page Réglages des documents).
        return DocumentType.objects.all() if self.action == "model" else super().get_queryset()

    @action(detail=True, methods=["get", "post", "delete"])
    def model(self, request, pk=None):
        """Le modèle Word / PDF d'un type (2026-11-17) : GET -> le télécharger (les RH) ; POST {"file"} -> le mettre ou
        le remplacer, DELETE -> l'enlever (Admin RH et l'IT)."""
        doc_type = self.get_object()
        if request.method == "GET":
            if not IsHR().has_permission(request, self) or not doc_type.model_file:
                raise NotFound()
            return FileResponse(doc_type.model_file.open("rb"), as_attachment=True, filename=doc_type.model_name or "modele")
        if not IsHRAdmin().has_permission(request, self):
            raise PermissionDenied("Seule Admin RH change les modèles.")
        if request.method == "DELETE":
            if doc_type.model_file:
                doc_type.model_file.delete(save=False)
            doc_type.model_name = ""
            doc_type.save(update_fields=["model_file", "model_name"])
        else:
            run(lambda: set_model(doc_type, request.FILES.get("file")))
        return Response(DocumentTypeSerializer(doc_type).data)


class MyDocumentViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """mine/ : MES demandes ; + pour un manager (2026-11-16) : son équipe et ce qu'il a demandé pour elle."""

    serializer_class = DocumentRequestSerializer

    def get_queryset(self):
        return documents().filter(employee__user=self.request.user)

    @action(detail=False, url_path="team-members")
    def team_members(self, request):
        """Les personnes dont je suis le N+1 (pour "For": demander un document pour l'une d'elles). Vide : pas d'équipe."""
        # Admin RH ne le permet pas (ou pas à moi) : liste vide, donc pas de champ "For" dans le formulaire.
        if not DocumentSettings.load().manager_allowed(request.user):
            return Response([])
        me = Employee.objects.filter(user=request.user).select_related("department__direction__entity__pole").first()
        return Response([{"id": member.pk, "first_name": member.first_name, "last_name": member.last_name,
                          "position": member.position.name} for member in my_team(me)])

    @action(detail=False)
    def options(self, request):
        """Ce que le formulaire propose (réglages d'Admin RH) : {"formats": ["PDF", "ORIGINAL", "BOTH"]}."""
        return Response({"formats": DocumentSettings.load().formats()})

    @action(detail=False, url_path="for-team")
    def for_team(self, request):
        """Ce que J'AI demandé pour mon équipe : où ça en est (jamais le document lui-même : can_download est faux)."""
        rows = documents().filter(requested_by=request.user).exclude(employee__user=request.user)
        return Response(DocumentRequestSerializer(rows, many=True, context={"request": request}).data)

    def create(self, request):
        # "employee" (facultatif) : un RH demande POUR un collaborateur de son pôle ; sinon, pour moi.
        employee_id = str(request.data.get("employee") or "")
        if employee_id:
            employee = Employee.objects.filter(pk=employee_id).first() if employee_id.isdigit() else None
        else:
            employee = Employee.objects.filter(user=request.user).first()
        if employee is None:
            raise NotFound("Aucun dossier RH n'est lié à ce compte." if not employee_id else "Collaborateur introuvable.")
        # "doc_types": [ids] (cases à cocher, 2026-11-17 : un ou plusieurs documents dans une demande) ; "doc_type" :
        # un seul (l'ancienne forme, gardée).
        wanted = request.data.get("doc_types")
        if not isinstance(wanted, list):
            wanted = [request.data.get("doc_type")] if request.data.get("doc_type") else []
        ids = [str(value) for value in wanted if str(value).isdigit()]
        found = {str(doc_type.pk): doc_type for doc_type in DocumentType.objects.filter(pk__in=ids)}
        if not ids or len(found) != len(set(ids)):
            raise serializers.ValidationError({"doc_type": ["Choisissez au moins un document."]})
        created = run(lambda: request_documents(employee, [found[value] for value in ids], request.data.get("purpose", ""),
                                                by=request.user, format=request.data.get("format") or DocumentRequest.Format.PDF))
        rows = documents().filter(pk__in=[document.pk for document in created]).order_by("id")
        return Response(DocumentRequestSerializer(rows, many=True, context={"request": request}).data, status=status.HTTP_201_CREATED)


class DocumentSettingsView(APIView):
    """GET / PATCH settings/ : les réglages des documents (formats proposés, managers), Admin RH et l'IT."""

    permission_classes = [IsHRAdmin]

    def get(self, request):
        return Response(DocumentSettingsSerializer(DocumentSettings.load()).data)

    def patch(self, request):
        data = DocumentSettingsSerializer(DocumentSettings.load(), data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        data.save(updated_by=request.user)
        return Response(DocumentSettingsSerializer(DocumentSettings.load()).data)


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


class ByRequestViewSet(viewsets.GenericViewSet):
    """GET requests/<request>/ -> LES documents d'une demande (2026-11-17 : un ou plusieurs ; où chacun en est : à
    préparer, livré, la référence...), pour l'historique de la demande, Team approvals et le panneau Détails.
    Mêmes droits que l'historique ; sinon 404 (aussi une demande sans document)."""

    def retrieve(self, request, pk=None):
        rows = documents().filter(request=pk, request__in=engine.requests_visible_to(request.user)).order_by("id")
        if not rows:
            raise NotFound()
        return Response(DocumentRequestSerializer(rows, many=True, context={"request": request}).data)


class FileViewSet(viewsets.GenericViewSet):
    """GET files/<document>/ -> le PDF livré (le numéro du DOCUMENT : une demande peut en avoir plusieurs). Pour ceux
    que la demande concerne (le collaborateur, les RH de son pôle, Admin RH, IT : la même règle que l'historique) ;
    sinon 404, comme s'il n'existait pas."""

    def get_queryset(self):
        return DocumentRequest.objects.filter(request__in=engine.requests_visible_to(self.request.user))

    def retrieve(self, request, pk=None):
        document = self.get_object()
        # Le fichier : le collaborateur et ses RH SEULEMENT. Le manager qui a saisi la demande suit son historique,
        # mais le document est privé (2026-11-16) : 404, comme s'il n'existait pas.
        if request.user.pk != document.employee.user_id and not can_prepare(request.user, document):
            raise NotFound()
        # ?draft=1 : le brouillon sans signature, à imprimer : les RH seulement (jamais le collaborateur).
        if request.query_params.get("draft"):
            if not document.draft or not can_prepare(request.user, document):
                raise NotFound()
            return FileResponse(document.draft.open("rb"), as_attachment=True, filename=f"brouillon-{document.reference or document.request_id}.pdf")
        # "Original" seul : pas de PDF pour le collaborateur (il attend le papier).
        if not document.file or (not document.needs_pdf and not can_prepare(request.user, document)):
            raise NotFound()
        return FileResponse(document.file.open("rb"), as_attachment=True, filename=document.file_name or "document.pdf")


class HrDocumentViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Les demandes de document du pôle (RH ; Admin RH et IT : les deux pôles), pour préparer et déposer."""

    serializer_class = DocumentRequestSerializer
    permission_classes = [IsHR]
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # multipart : le PDF est un fichier
    # hr/<document>/... : le numéro du DOCUMENT (2026-11-17 : une demande peut en avoir plusieurs, chacun préparé à part).

    @staticmethod
    def filters():
        """?status= -> le filtre : à préparer (PDF et / ou original), à valider, original à remettre, tout livré."""
        to_prepare, pickup = DocumentRequest.to_prepare_filter(), DocumentRequest.pickup_filter()
        return {
            "to_prepare": to_prepare,
            "in_progress": Q(request__status=Request.Status.IN_PROGRESS),
            "pickup": pickup,
            "ready": Q(request__status=Request.Status.APPROVED) & ~to_prepare & ~pickup,
        }

    def get_queryset(self):
        queryset = documents()
        user = self.request.user
        if limited_to_own_pole(user):
            pole = user_pole(user)
            queryset = queryset.filter(employee__department__direction__entity__pole=pole) if pole else queryset.none()
        if self.action == "list":
            params = self.request.query_params
            wanted = params.get("status")
            queryset = queryset.filter(self.filters().get(wanted, Q()))
            # Step B (2026-11-13) : retrouver une demande parmi des centaines. Le nom (ou le matricule) du
            # collaborateur, le type de document, la période (date de la demande, "du ... au ...").
            for word in params.get("search", "").split():
                queryset = queryset.filter(Q(employee__last_name__icontains=word) | Q(employee__first_name__icontains=word)
                                           | Q(employee__u_number__icontains=word))
            if params.get("type", "").isdigit():
                queryset = queryset.filter(doc_type=params["type"])
            for name, lookup in (("from", "request__created_at__date__gte"), ("to", "request__created_at__date__lte")):
                try:
                    day = parse_date(params.get(name, "") or "")
                except ValueError:  # une date impossible (31/02) : on ignore ce filtre
                    day = None
                if day:
                    queryset = queryset.filter(**{lookup: day})
            if wanted in ("to_prepare", "in_progress"):
                queryset = queryset.order_by("due_date", "id")  # à faire : le délai le plus proche d'abord
        return queryset

    @action(detail=True, methods=["post"])
    def upload(self, request, pk=None):
        document = self.get_object()
        run(lambda: upload(document, request.user, request.FILES.get("file")))
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk), context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """"Download" (étape ① des RH, 2026-11-17) : un document GÉNÉRÉ -> le PDF sans signature (texte du moment) ;
        un document préparé par les RH -> le modèle Word / PDF de son type (mis par Admin RH). Sinon 404."""
        document = self.get_object()
        if not can_prepare(request.user, document):
            raise NotFound()
        if document.doc_type.template:
            response = HttpResponse(draft_bytes(document), content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="brouillon-{document.reference}.pdf"'
            return response
        if not document.doc_type.model_file:
            raise NotFound("Pas de modèle pour ce document : Admin RH peut en mettre un (Réglages des documents).")
        return FileResponse(document.doc_type.model_file.open("rb"), as_attachment=True,
                            filename=document.doc_type.model_name or "modele")

    @action(detail=True, methods=["get", "post"])
    def text(self, request, pk=None):
        """Step 3 : GET -> le texte à relire (relu, sinon celui de la fiche) ; POST {"text"} -> l'enregistrer et
        (re)fabriquer le document : livré s'il est signé par l'application, sinon le brouillon à imprimer."""
        document = self.get_object()
        if request.method == "GET":
            if not document.doc_type.template:
                raise NotFound("Pas de texte généré pour ce document.")
            return Response({"text": text_of(document)})
        run(lambda: save_text(document, request.user, request.data.get("text", "")))
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk), context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="preview-text")
    def preview_text(self, request, pk=None):
        """L'aperçu du document avec CE texte (rien n'est enregistré), comme il sera envoyé."""
        document = self.get_object()
        if not document.doc_type.template:
            raise NotFound("Pas de texte généré pour ce document.")
        text = str(request.data.get("text", "")).strip()[:MAX_TEXT] or text_of(document)
        if not document.reference:
            document.reference = "APERÇU"
        content = TEMPLATES[document.doc_type.template](document, signed=auto_signed(document), text=text)
        response = HttpResponse(content, content_type="application/pdf")
        response["Content-Disposition"] = 'inline; filename="apercu.pdf"'
        return response

    @action(detail=True, methods=["post"], url_path="original-ready")
    def original_ready(self, request, pk=None):
        document = self.get_object()
        run(lambda: mark_original_ready(document, request.user))
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk), context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="handed-over")
    def handed_over(self, request, pk=None):
        document = self.get_object()
        # {"to": "manager"} : remis à son manager venu pour lui ; sinon au collaborateur lui-même.
        run(lambda: mark_handed_over(document, request.user, to_manager=request.data.get("to") == "manager"))
        return Response(DocumentRequestSerializer(documents().get(pk=document.pk), context={"request": request}).data)
