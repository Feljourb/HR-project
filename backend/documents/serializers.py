from rest_framework import serializers

from workflows.serializers import name_of, person

from .models import DocumentRequest, DocumentSignatory, DocumentType
from .services import can_prepare


class DocumentTypeSerializer(serializers.ModelSerializer):
    # true : l'application génère le PDF dès la validation ; false : les RH le préparent.
    automatic = serializers.SerializerMethodField()

    class Meta:
        model = DocumentType
        fields = ["id", "name", "template", "automatic", "delivery_days"]

    def get_automatic(self, doc_type):
        return bool(doc_type.template)


class SignatorySerializer(serializers.ModelSerializer):
    """Le signataire d'un pôle (page Lists -> Documents -> Signatures, Admin RH). Les images ne sont jamais
    envoyées ici : seulement si elles existent (has_*) ; on les voit avec signatories/<id>/image/?kind=..."""

    pole = serializers.CharField(source="pole.name", read_only=True)
    has_signature = serializers.SerializerMethodField()
    has_stamp = serializers.SerializerMethodField()
    updated_by = serializers.SerializerMethodField()

    class Meta:
        model = DocumentSignatory
        fields = ["id", "pole", "name", "title", "city", "mode", "has_signature", "has_stamp", "updated_at", "updated_by"]
        read_only_fields = ["updated_at"]

    def get_has_signature(self, signatory):
        return bool(signatory.signature)

    def get_has_stamp(self, signatory):
        return bool(signatory.stamp)

    def get_updated_by(self, signatory):
        return name_of(signatory.updated_by) if signatory.updated_by_id else None


class DocumentRequestSerializer(serializers.ModelSerializer):
    """Une demande de document, pour "My documents" (le collaborateur) et "Document requests" (les RH).
    `request` = le numéro de la demande du moteur : l'historique (/requests/<n>) et le fichier (/files/<n>/)."""

    doc_type = serializers.CharField(source="doc_type.name")
    automatic = serializers.SerializerMethodField()
    status = serializers.CharField(source="request.status")
    state = serializers.CharField()  # IN_PROGRESS, TO_PREPARE, READY, REJECTED, CANCELLED
    created_at = serializers.DateTimeField(source="request.created_at")
    closed_at = serializers.DateTimeField(source="request.closed_at")
    employee = serializers.SerializerMethodField()
    department = serializers.CharField(source="employee.department.name")
    has_file = serializers.SerializerMethodField()
    delivered_by = serializers.SerializerMethodField()
    refusal = serializers.SerializerMethodField()
    requested_by = serializers.SerializerMethodField()  # le RH qui a demandé POUR le collaborateur, ou null
    late = serializers.BooleanField(read_only=True)     # pas livré et le délai promis est passé
    # Celui qui lit peut déposer / remplacer le PDF (un RH du pôle, un document préparé par les RH, validé) :
    # le bouton "Upload PDF" apparaît aussi dans l'historique et dans Team approvals, là où le RH se trouve.
    can_upload = serializers.SerializerMethodField()
    format_label = serializers.CharField(source="get_format_display", read_only=True)

    class Meta:
        model = DocumentRequest
        fields = ["id", "request", "doc_type", "automatic", "purpose", "format", "format_label", "status", "state", "created_at", "closed_at",
                  "employee", "department", "reference", "file_name", "has_file", "delivered_at", "delivered_by", "refusal",
                  "requested_by", "due_date", "late", "can_upload"]

    def get_can_upload(self, document):
        viewer = self.context.get("request")
        return bool(viewer and not document.doc_type.template and document.state in ("TO_PREPARE", "READY")
                    and can_prepare(viewer.user, document))

    def get_requested_by(self, document):
        return name_of(document.requested_by) if document.requested_by_id else None

    def get_automatic(self, document):
        return bool(document.doc_type.template)

    def get_employee(self, document):
        return person(document.employee)

    def get_has_file(self, document):
        return bool(document.file)

    def get_delivered_by(self, document):
        # "Generated" (l'application) ou le nom du RH qui a déposé le fichier.
        if not document.delivered_at:
            return None
        return name_of(document.delivered_by) if document.delivered_by_id else None

    def get_refusal(self, document):
        # Le motif du refus des RH (le commentaire est obligatoire pour refuser), affiché dans "My documents".
        rejected = next((step for step in document.request.steps.all() if step.status == "REJECTED"), None)
        return rejected.comment if rejected else ""
