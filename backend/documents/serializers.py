from rest_framework import serializers

from employees.models import Employee
from workflows.serializers import name_of, person

from .models import DocumentRequest, DocumentSettings, DocumentSignatory, DocumentType
from .services import auto_signed, can_prepare


class DocumentTypeSerializer(serializers.ModelSerializer):
    # true : l'application génère le PDF dès la validation ; false : les RH le préparent.
    automatic = serializers.SerializerMethodField()
    has_model = serializers.SerializerMethodField()  # un modèle Word / PDF à télécharger (types préparés par les RH)

    class Meta:
        model = DocumentType
        fields = ["id", "name", "template", "automatic", "delivery_days", "manager_can_request", "hr_review",
                  "has_model", "model_name", "body_template"]

    def get_automatic(self, doc_type):
        return bool(doc_type.template)

    def get_has_model(self, doc_type):
        return bool(doc_type.model_file)


class DocumentSettingsSerializer(serializers.ModelSerializer):
    """Les réglages des documents (Admin RH). chosen_managers = des ids de fiches ; chosen_labels = leurs noms."""

    chosen_managers = serializers.PrimaryKeyRelatedField(many=True, queryset=Employee.objects.all(), required=False)
    chosen_labels = serializers.SerializerMethodField()
    updated_by = serializers.SerializerMethodField()

    class Meta:
        model = DocumentSettings
        fields = ["offer_pdf", "offer_original", "offer_both", "manager_requests", "chosen_managers", "chosen_labels",
                  "pickup_days", "min_notice_days", "updated_at", "updated_by"]
        read_only_fields = ["updated_at"]

    def validate_pickup_days(self, days):
        # Des jours de la semaine de travail : 0 = lundi ... 4 = vendredi, chacun une fois, dans l'ordre.
        if not isinstance(days, list) or any(not isinstance(day, int) or not 0 <= day <= 4 for day in days):
            raise serializers.ValidationError("Choisissez des jours du lundi au vendredi.")
        return sorted(set(days))

    def get_chosen_labels(self, current):
        return [{"id": employee.pk, "name": person(employee)} for employee in current.chosen_managers.all()]

    def get_updated_by(self, current):
        return name_of(current.updated_by) if current.updated_by_id else None

    def validate(self, data):
        # Au moins un format proposé (sinon le formulaire ne pourrait rien envoyer).
        current = self.instance
        pick = {name: data.get(name, getattr(current, name)) for name in ("offer_pdf", "offer_original", "offer_both")}
        if not any(pick.values()):
            raise serializers.ValidationError({"offer_pdf": ["Proposez au moins un format."]})
        return data


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
    # L'original papier (format ORIGINAL / BOTH) : TO_SIGN, PICKUP, COLLECTED, ou null ; qui l'a préparé / remis.
    original_state = serializers.CharField(read_only=True)
    original_ready_by = serializers.SerializerMethodField()
    collected_by = serializers.SerializerMethodField()
    can_download = serializers.SerializerMethodField()        # le PDF, pour celui qui lit
    can_handle_original = serializers.SerializerMethodField()  # boutons "Original ready" / "Handed over" (RH)
    can_print = serializers.SerializerMethodField()           # le brouillon sans signature, à imprimer (RH seulement)
    # Step 3 : le texte d'un document généré, relu par les RH avant l'envoi.
    needs_review = serializers.SerializerMethodField()   # "Relecture RH" demandée et pas encore faite (rien n'est fabriqué)
    can_edit_text = serializers.SerializerMethodField()  # le RH peut relire / modifier le texte (pas encore livré)
    # Qui a relu le texte, et quand : une étape INTERNE des RH (2026-11-16 : le collaborateur et son manager ne la
    # voient pas) -> null pour eux, seulement les RH la reçoivent.
    text_reviewed_by = serializers.SerializerMethodField()
    body_edited_at = serializers.SerializerMethodField()
    # ① "Download" des RH (2026-11-17) : "draft" (un document généré : le PDF sans signature), "model" (le modèle Word /
    # PDF du type), ou null (rien à télécharger : les RH le préparent dans leur outil).
    hr_download = serializers.SerializerMethodField()
    model_name = serializers.CharField(source="doc_type.model_name", read_only=True)  # le nom du fichier téléchargé
    # Les RH : la signature est posée par l'application (pas besoin d'imprimer un PDF : "Send to the employee").
    signed_by_app = serializers.SerializerMethodField()
    handed_to = serializers.SerializerMethodField()   # à qui l'original a été remis (le collaborateur ou son manager)
    manager = serializers.SerializerMethodField()     # son manager (N+1), pour "Handed over to: ... his manager"

    class Meta:
        model = DocumentRequest
        fields = ["id", "request", "doc_type", "automatic", "purpose", "format", "format_label", "status", "state", "created_at", "closed_at",
                  "employee", "department", "reference", "file_name", "has_file", "delivered_at", "delivered_by", "refusal",
                  "requested_by", "due_date", "late", "can_upload", "can_download", "can_print",
                  "original_state", "original_ready_at", "original_ready_by", "collected_at", "collected_by", "can_handle_original",
                  "handed_to", "manager", "needs_review", "can_edit_text", "text_reviewed_by", "body_edited_at", "hr_download", "model_name", "needed_by", "signed_by_app"]

    def get_signed_by_app(self, document):
        return bool(document.doc_type.template) and self.is_hr(document) and auto_signed(document)

    def get_hr_download(self, document):
        if document.request.status != "APPROVED" or not self.is_hr(document):
            return None
        if document.doc_type.template:
            return "draft"
        return "model" if document.doc_type.model_file else None

    def get_needs_review(self, document):
        return bool(document.doc_type.template and document.doc_type.hr_review and document.request.status == "APPROVED"
                    and not document.file and not document.body_edited_at)

    def get_can_edit_text(self, document):
        return bool(document.doc_type.template and document.request.status == "APPROVED" and not document.file
                    and self.is_hr(document))

    def get_text_reviewed_by(self, document):
        return name_of(document.body_edited_by) if document.body_edited_by_id and self.is_hr(document) else None

    def get_body_edited_at(self, document):
        return document.body_edited_at if document.body_edited_at and self.is_hr(document) else None

    def get_handed_to(self, document):
        return person(document.handed_to) if document.handed_to_id else None

    def get_manager(self, document):
        # Seulement quand l'original attend : le RH choisit à qui il le remet. Sinon inutile (et une requête de moins).
        if document.original_state != "PICKUP":
            return None
        boss = document.employee.n_plus_1
        return person(boss) if boss else None

    def is_hr(self, document):
        """Celui qui lit est un RH qui s'occupe de ce document (RH du pôle, Admin RH, IT)."""
        viewer = self.context.get("request")
        return bool(viewer and can_prepare(viewer.user, document))

    def get_can_upload(self, document):
        # Le PDF signé pas encore livré (préparé par les RH, ou généré "à signer à la main"). Livré : il ne change
        # plus (2026-11-13) ; une correction = une nouvelle demande.
        return (document.needs_pdf and document.request.status == "APPROVED" and not document.file
                and not self.get_needs_review(document) and self.is_hr(document))

    def get_can_print(self, document):
        return bool(document.draft) and document.request.status == "APPROVED" and self.is_hr(document)

    def get_can_download(self, document):
        # Le collaborateur (s'il a demandé le PDF) et ses RH. Jamais le manager qui a fait la demande pour lui
        # (2026-11-16 : il suit où elle en est, le document est privé) ; "original" seul : le collaborateur attend le papier.
        viewer = self.context.get("request")
        mine = bool(viewer) and viewer.user.pk == document.employee.user_id
        return bool(document.file) and ((mine and document.needs_pdf) or self.is_hr(document))

    def get_can_handle_original(self, document):
        # Pas avant la relecture du texte (step 3) : on imprime le texte relu.
        return (document.original_state in ("TO_SIGN", "PICKUP") and not self.get_needs_review(document)
                and self.is_hr(document))

    def get_original_ready_by(self, document):
        return name_of(document.original_ready_by) if document.original_ready_by_id else None

    def get_collected_by(self, document):
        return name_of(document.collected_by) if document.collected_by_id else None

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
