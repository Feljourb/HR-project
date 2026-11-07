"""Step 6 : les congés en JSON."""
from decimal import Decimal

from rest_framework import serializers

from employees.serializers import ReferenceSerializer
from workflows.serializers import person

from .holidays import in_window, is_fixed
from .models import AnnualRightChange, BalanceAdjustment, LeaveRecount, LeaveRequest, LeaveType, PublicHoliday


class LeaveTypeSerializer(serializers.ModelSerializer):
    """Un type, pour la liste du formulaire : {"id": 1, "name": "Congé annuel", "deducts_balance": true, "max_days": null}."""

    max_days = serializers.DecimalField(max_digits=5, decimal_places=1, coerce_to_string=False, allow_null=True)

    class Meta:
        model = LeaveType
        fields = ["id", "name", "deducts_balance", "max_days"]


class PublicHolidaySerializer(serializers.ModelSerializer):
    """Un jour férié : {"id", "date", "name", "estimated"} (estimated : fête religieuse calculée, à confirmer)."""

    class Meta:
        model = PublicHoliday
        fields = ["id", "date", "name", "estimated"]


class HolidayListSerializer(ReferenceSerializer):
    """Un jour férié dans la page "Reference lists" (Admin RH). Comme les autres listes, sauf un détail :
    DRF ajoute tout seul un contrôle "date unique" avec un message anglais ("... already exists").
    On l'enlève : la règle du modèle (full_clean) donne le message en français.
    + "fixed" : l'onglet de la page (fêtes fixes / variables)."""

    fixed = serializers.SerializerMethodField()

    class Meta:
        model = PublicHoliday
        fields = "__all__"
        extra_kwargs = {"date": {"validators": []}}

    def get_fixed(self, holiday):
        return is_fixed(holiday)


class LeaveInputSerializer(serializers.Serializer):
    """Ce que le formulaire envoie, pour l'aperçu ET pour l'envoi (les mêmes champs).
    Ici : seulement la FORME (une date est une date...). Les règles (solde, chevauchement...) sont dans le modèle."""

    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.all())
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    starts_afternoon = serializers.BooleanField(default=False)
    ends_noon = serializers.BooleanField(default=False)
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=1000)

    def validate(self, data):
        # Une date à moins de 5 ans d'aujourd'hui : "0002-11-10" (une année pas encore tapée en entier) est
        # refusée tout de suite, sans calcul (sinon : 2000 ans de jours à compter, et des jours fériés créés).
        for name in ("start_date", "end_date"):
            if not in_window(data[name].year):
                raise serializers.ValidationError({name: f"Année impossible ({data[name].year}) : vérifiez la date."})
        return data


class RecountSerializer(serializers.ModelSerializer):
    """Un recalcul du congé (un jour férié a changé) : {"old_days": 4, "new_days": 3, "reason": "...", ...}."""

    old_days = serializers.DecimalField(max_digits=5, decimal_places=1, coerce_to_string=False)
    new_days = serializers.DecimalField(max_digits=5, decimal_places=1, coerce_to_string=False)
    changed_by = serializers.StringRelatedField()  # le compte qui a changé le jour férié (ou null)

    class Meta:
        model = LeaveRecount
        fields = ["old_days", "new_days", "reason", "warning", "changed_by", "created_at"]


class RightChangeSerializer(serializers.ModelSerializer):
    """P1 step 2 : un changement du droit annuel, dans le panneau RH."""

    annual_days = serializers.DecimalField(max_digits=5, decimal_places=2, coerce_to_string=False)
    changed_by = serializers.StringRelatedField()

    class Meta:
        model = AnnualRightChange
        fields = ["id", "effective_from", "annual_days", "reason", "changed_by", "created_at"]


class RightChangeInputSerializer(serializers.Serializer):
    """Ce que le formulaire "Change the annual right" envoie (la forme ; les règles sont dans le modèle)."""

    annual_days = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal("0"))
    effective_from = serializers.DateField()
    reason = serializers.CharField(max_length=200)


class AdjustmentSerializer(serializers.ModelSerializer):
    """P1 step 3 : une correction du solde, dans le panneau RH."""

    days = serializers.DecimalField(max_digits=5, decimal_places=2, coerce_to_string=False)
    created_by = serializers.StringRelatedField()

    class Meta:
        model = BalanceAdjustment
        fields = ["id", "date", "days", "reason", "created_by", "created_at"]


class AdjustmentInputSerializer(serializers.Serializer):
    """Ce que le formulaire "Add a correction" envoie (la forme ; les règles sont dans le modèle)."""

    days = serializers.DecimalField(max_digits=5, decimal_places=2)
    date = serializers.DateField()
    reason = serializers.CharField(max_length=200)


class LeaveRequestSerializer(serializers.ModelSerializer):
    """Un de MES congés, pour "Mes congés". Le statut vient du moteur (request.status)."""

    leave_type_label = serializers.StringRelatedField(source="leave_type")
    recounts = RecountSerializer(many=True, read_only=True)  # vide la plupart du temps
    days = serializers.DecimalField(max_digits=5, decimal_places=1, coerce_to_string=False)  # 2.5, pas "2.5"
    status = serializers.CharField(source="request.status")
    status_label = serializers.CharField(source="request.get_status_display")
    created_at = serializers.DateTimeField(source="request.created_at")

    class Meta:
        model = LeaveRequest
        # request = le numéro de la demande du moteur : pour l'annuler (/api/workflows/requests/<id>/cancel/)
        # et ouvrir son historique (/requests/<id>).
        fields = ["id", "request", "leave_type", "leave_type_label", "start_date", "end_date", "starts_afternoon",
                  "ends_noon", "days", "reason", "status", "status_label", "created_at", "recounts"]
        read_only_fields = fields


class AbsenceSerializer(LeaveRequestSerializer):
    """Step 8 : un congé dans la page "Absences" des RH : le même congé, + QUI et OÙ."""

    employee = serializers.SerializerMethodField()
    employee_id = serializers.IntegerField(source="employee.pk")
    department = serializers.CharField(source="employee.department.name")
    pole = serializers.CharField(source="employee.pole.name")

    class Meta(LeaveRequestSerializer.Meta):
        fields = ["employee", "employee_id", "department", "pole", *LeaveRequestSerializer.Meta.fields]
        read_only_fields = fields

    def get_employee(self, leave):
        return person(leave.employee)  # "Sara Alami"
