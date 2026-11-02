"""Step 6 : les congés en JSON."""
from rest_framework import serializers

from employees.serializers import ReferenceSerializer
from workflows.serializers import person

from .models import LeaveRequest, LeaveType, PublicHoliday


class LeaveTypeSerializer(serializers.ModelSerializer):
    """Un type, pour la liste du formulaire : {"id": 1, "name": "Congé annuel", "deducts_balance": true, "max_days": null}."""

    max_days = serializers.DecimalField(max_digits=5, decimal_places=1, coerce_to_string=False, allow_null=True)

    class Meta:
        model = LeaveType
        fields = ["id", "name", "deducts_balance", "max_days"]


class PublicHolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = PublicHoliday
        fields = ["id", "date", "name"]


class HolidayListSerializer(ReferenceSerializer):
    """Un jour férié dans la page "Reference lists" (Admin RH). Comme les autres listes, sauf un détail :
    DRF ajoute tout seul un contrôle "date unique" avec un message anglais ("... already exists").
    On l'enlève : la règle du modèle (full_clean) donne le message en français."""

    class Meta:
        model = PublicHoliday
        fields = "__all__"
        extra_kwargs = {"date": {"validators": []}}


class LeaveInputSerializer(serializers.Serializer):
    """Ce que le formulaire envoie, pour l'aperçu ET pour l'envoi (les mêmes champs).
    Ici : seulement la FORME (une date est une date...). Les règles (solde, chevauchement...) sont dans le modèle."""

    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.all())
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    starts_afternoon = serializers.BooleanField(default=False)
    ends_noon = serializers.BooleanField(default=False)
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=1000)


class LeaveRequestSerializer(serializers.ModelSerializer):
    """Un de MES congés, pour "Mes congés". Le statut vient du moteur (request.status)."""

    leave_type_label = serializers.StringRelatedField(source="leave_type")
    days = serializers.DecimalField(max_digits=5, decimal_places=1, coerce_to_string=False)  # 2.5, pas "2.5"
    status = serializers.CharField(source="request.status")
    status_label = serializers.CharField(source="request.get_status_display")
    created_at = serializers.DateTimeField(source="request.created_at")

    class Meta:
        model = LeaveRequest
        # request = le numéro de la demande du moteur : pour l'annuler (/api/workflows/requests/<id>/cancel/)
        # et ouvrir son historique (/requests/<id>).
        fields = ["id", "request", "leave_type", "leave_type_label", "start_date", "end_date", "starts_afternoon",
                  "ends_noon", "days", "reason", "status", "status_label", "created_at"]
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
