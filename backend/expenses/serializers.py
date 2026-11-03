"""Les notes de frais en JSON."""
from decimal import Decimal

from rest_framework import serializers

from workflows.serializers import person

from .models import TOO_HIGH, ExpenseCategory, ExpenseClaim, ExpenseLine, ExpenseScale


def amount_field(**kwargs):
    # 1250.5 et pas "1250.50" : le frontend calcule et affiche directement.
    return serializers.DecimalField(max_digits=12, decimal_places=2, coerce_to_string=False, **kwargs)


class CategorySerializer(serializers.ModelSerializer):
    """{"id", "name", "ceiling": "HOTEL", "ceiling_label": "Hôtel (par nuit)", "receipt_required": true}."""

    ceiling_label = serializers.CharField(source="get_ceiling_display", read_only=True)

    class Meta:
        model = ExpenseCategory
        fields = ["id", "name", "ceiling", "ceiling_label", "receipt_required"]


class ScaleSerializer(serializers.ModelSerializer):
    """Le barème d'un grade. Admin RH change seulement les montants (pas le grade)."""

    grade_label = serializers.StringRelatedField(source="grade")
    daily_allowance = amount_field(min_value=Decimal("0.01"))
    transport = amount_field(min_value=Decimal("0.01"))
    hotel = amount_field(min_value=Decimal("0.01"))

    class Meta:
        model = ExpenseScale
        fields = ["id", "grade", "grade_label", "daily_allowance", "transport", "hotel"]
        read_only_fields = ["grade"]


class LineInputSerializer(serializers.Serializer):
    """Une dépense telle que le formulaire l'envoie (le justificatif arrive à part, comme fichier).
    Ici seulement la FORME ; les règles (plafond, futur, justificatif) sont dans le modèle."""

    date = serializers.DateField()
    category = serializers.PrimaryKeyRelatedField(queryset=ExpenseCategory.objects.all())
    # Un nombre énorme (ex. 1 000 000 000 000) : le même message clair que le modèle, pas "trop de chiffres".
    amount = serializers.DecimalField(max_digits=10, decimal_places=2,
                                      error_messages={"max_digits": TOO_HIGH, "max_whole_digits": TOO_HIGH})
    description = serializers.CharField(required=False, allow_blank=True, default="", max_length=200)


class LineSerializer(serializers.ModelSerializer):
    category_label = serializers.StringRelatedField(source="category")
    amount = amount_field()
    has_receipt = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseLine
        fields = ["id", "date", "category", "category_label", "amount", "description", "has_receipt", "receipt_name"]

    def get_has_receipt(self, line):
        return bool(line.receipt)


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

    class Meta:
        model = ExpenseClaim
        fields = ["id", "request", "title", "total", "status", "status_label", "created_at", "waiting_for",
                  "reimbursed_at", "reimbursed_by", "employee", "department", "pole", "grade", "lines"]
        read_only_fields = fields

    def get_employee(self, claim):
        return person(claim.employee)

    def get_waiting_for(self, claim):
        """Qui doit répondre maintenant : "Youssef Bennani (N+1)", ou null (plus rien n'attend)."""
        step = next((s for s in claim.request.steps.all() if s.status == "PENDING"), None)
        if step is None:
            return None
        return f"{person(step.assignee)} ({step.get_approver_display()})" if step.assignee else step.get_approver_display()
