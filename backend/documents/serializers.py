from rest_framework import serializers

from workflows.serializers import name_of, person

from .models import DocumentRequest, DocumentType


class DocumentTypeSerializer(serializers.ModelSerializer):
    # true : l'application génère le PDF dès la validation ; false : les RH le préparent.
    automatic = serializers.SerializerMethodField()

    class Meta:
        model = DocumentType
        fields = ["id", "name", "template", "automatic"]

    def get_automatic(self, doc_type):
        return bool(doc_type.template)


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

    class Meta:
        model = DocumentRequest
        fields = ["id", "request", "doc_type", "automatic", "purpose", "status", "state", "created_at", "closed_at",
                  "employee", "department", "reference", "file_name", "has_file", "delivered_at", "delivered_by", "refusal"]

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
