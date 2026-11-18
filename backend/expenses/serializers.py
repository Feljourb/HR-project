"""Les notes de frais en JSON."""
from decimal import Decimal

from rest_framework import serializers

from workflows.serializers import name_of, person

from .models import (TOO_HIGH, Currency, ExpenseCategory, ExpenseClaim, ExpenseCorrection, ExpenseLine, ExpenseReceipt,
                     ExpenseSettings)
from .services import correction_role


def amount_field(**kwargs):
    # 1250.5 et pas "1250.50" : le frontend calcule et affiche directement.
    return serializers.DecimalField(max_digits=12, decimal_places=2, coerce_to_string=False, **kwargs)


class CategorySerializer(serializers.ModelSerializer):
    """Une catégorie pour le formulaire : {"id", "name", "per": "NIGHT", "per_label": "par nuit", "receipt_required",
    "above_ceiling_allowed", "my_ceiling": 400 ou null} (my_ceiling : le plafond pour MON grade, context "grade")."""

    per_label = serializers.CharField(source="get_per_display", read_only=True)
    my_ceiling = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseCategory
        fields = ["id", "name", "per", "per_label", "receipt_required", "above_ceiling_allowed", "my_ceiling"]

    def get_my_ceiling(self, category):
        grade = self.context.get("grade")
        row = next((item for item in category.ceilings.all() if item.grade_id == grade), None) if grade else None
        return float(row.amount) if row else None


class LineInputSerializer(serializers.Serializer):
    """Une dépense telle que le formulaire l'envoie (le justificatif arrive à part, comme fichier).
    Ici seulement la FORME ; les règles (plafond, futur, justificatif) sont dans le modèle."""

    date = serializers.DateField()
    category = serializers.PrimaryKeyRelatedField(queryset=ExpenseCategory.objects.all())
    # Un nombre énorme (ex. 1 000 000 000 000) : le même message clair que le modèle, pas "trop de chiffres".
    amount = serializers.DecimalField(max_digits=10, decimal_places=2,
                                      error_messages={"max_digits": TOO_HIGH, "max_whole_digits": TOO_HIGH})
    description = serializers.CharField(required=False, allow_blank=True, default="", max_length=200)
    justification = serializers.CharField(required=False, allow_blank=True, default="", max_length=300)
    # La devise du reçu (vide = MAD) : alors `amount` = le montant du reçu, converti en MAD par Django.
    currency = serializers.PrimaryKeyRelatedField(queryset=Currency.objects.all(), required=False, allow_null=True, default=None)


class ReceiptSerializer(serializers.ModelSerializer):
    """Un justificatif : seulement son numéro et son nom (le fichier : GET /api/expenses/receipts/<id>/)."""

    class Meta:
        model = ExpenseReceipt
        fields = ["id", "name"]


class CorrectionSerializer(serializers.ModelSerializer):
    """Une correction d'un montant (la trace) : 600 -> 400, motif, qui (et à quel titre), quand."""

    old_amount = amount_field()
    new_amount = amount_field()
    corrected_by = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseCorrection
        fields = ["id", "old_amount", "new_amount", "reason", "corrected_by", "as_role", "corrected_at"]

    def get_corrected_by(self, correction):
        return name_of(correction.corrected_by) if correction.corrected_by_id else None


class LineSerializer(serializers.ModelSerializer):
    category_label = serializers.StringRelatedField(source="category")
    amount = amount_field()  # le montant ACTUEL (après les corrections)
    receipts = ReceiptSerializer(many=True, read_only=True)  # 0 à 5 (ex. la facture + le ticket de carte)
    # Le plafond appliqué à l'envoi, et le dépassement (ex. 200) ou null : la puce orange "Above ceiling".
    ceiling = amount_field(allow_null=True)
    above_ceiling = amount_field(allow_null=True, read_only=True)
    # Les corrections des valideurs (la plus ancienne d'abord) ; la première dit le montant DEMANDÉ.
    corrections = CorrectionSerializer(many=True, read_only=True)
    # Une autre devise : "20,00 EUR × 10,9553" (null = payée en MAD).
    currency_code = serializers.CharField(source="currency.name", default=None, read_only=True)
    original_amount = amount_field(allow_null=True)
    rate = serializers.DecimalField(max_digits=12, decimal_places=4, coerce_to_string=False, allow_null=True)

    class Meta:
        model = ExpenseLine
        fields = ["id", "date", "category", "category_label", "amount", "description", "receipts",
                  "ceiling", "above_ceiling", "justification", "corrections", "currency_code", "original_amount", "rate"]


class CurrencySerializer(serializers.ModelSerializer):
    """Une devise pour le formulaire : {"id", "name": "EUR", "rate_to_mad": 10.9553, "rate_updated_at"}."""

    rate_to_mad = serializers.DecimalField(max_digits=12, decimal_places=4, coerce_to_string=False)

    class Meta:
        model = Currency
        fields = ["id", "name", "rate_to_mad", "rate_updated_at"]


class CorrectInputSerializer(serializers.Serializer):
    """Ce que le valideur envoie pour corriger une dépense (la forme ; les règles sont dans services.correct_line)."""

    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"))
    reason = serializers.CharField(max_length=300, allow_blank=True)


class ExpenseSettingsSerializer(serializers.ModelSerializer):
    updated_by = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseSettings
        fields = ["who_can_correct", "updated_at", "updated_by"]
        read_only_fields = ["updated_at"]

    def get_updated_by(self, current):
        return name_of(current.updated_by) if current.updated_by_id else None


class ClaimSerializer(serializers.ModelSerializer):
    """Une note de frais, ses lignes et où elle en est. `request` = le numéro de la demande du moteur :
    l'adresse de la note (/expenses/<request>), de son historique et de son annulation."""

    lines = LineSerializer(many=True, read_only=True)
    total = amount_field()
    status = serializers.CharField(source="request.status")
    status_label = serializers.CharField(source="request.get_status_display")
    created_at = serializers.DateTimeField(source="request.created_at")
    employee = serializers.SerializerMethodField()
    department = serializers.CharField(source="employee.department.name")
    pole = serializers.CharField(source="employee.pole.name")
    grade = serializers.StringRelatedField(source="employee.grade")
    waiting_for = serializers.SerializerMethodField()
    reimbursed_by = serializers.StringRelatedField()
    # Celui qui lit peut diminuer un montant MAINTENANT (la note attend sa réponse, et Admin RH le permet) :
    # le bouton "Correct" sur chaque dépense.
    can_correct = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseClaim
        fields = ["id", "request", "title", "total", "status", "status_label", "created_at", "waiting_for",
                  "reimbursed_at", "reimbursed_by", "employee", "department", "pole", "grade", "lines", "can_correct"]
        read_only_fields = fields

    def get_can_correct(self, claim):
        viewer = self.context.get("request")
        return bool(viewer) and correction_role(viewer.user, claim) is not None

    def get_employee(self, claim):
        return person(claim.employee)

    def get_waiting_for(self, claim):
        """Qui doit répondre maintenant : "Youssef Bennani (N+1)", ou null (plus rien n'attend)."""
        step = next((s for s in claim.request.steps.all() if s.status == "PENDING"), None)
        if step is None:
            return None
        return f"{person(step.assignee)} ({step.get_approver_display()})" if step.assignee else step.get_approver_display()
