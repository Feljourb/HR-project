"""Le JSON des arrivées et départs (pages "My tasks", "Arrivals & departures" et les réglages)."""
from django.utils import timezone
from rest_framework import serializers

from documents.models import DocumentType
from employees.models import Category, Employee
from workflows.serializers import name_of, person

from . import services
from .models import (Departure, DepartureType, ExitQuestion, Journey, JourneySettings, JourneyTask, NoticeRule, Owner,
                     TaskTemplate)
from .services import is_hr_of


def employee_card(employee):
    """Le petit résumé de la personne qui arrive / part : nom, matricule, poste, service, direction."""
    return {
        "id": employee.pk, "name": person(employee), "u_number": employee.u_number,
        "position": employee.position.name, "department": employee.department.name,
        "direction": employee.department.direction.name,
    }


class TaskSerializer(serializers.ModelSerializer):
    """Une tâche : quoi, qui, avant quand, et (faite) par qui + l'information notée."""

    person_name = serializers.SerializerMethodField()
    done_by_name = serializers.SerializerMethodField()
    late = serializers.SerializerMethodField()
    can_handle = serializers.SerializerMethodField()

    class Meta:
        model = JourneyTask
        fields = ["id", "name", "owner", "person_name", "due_date", "offset_days", "detail_label", "detail", "comment",
                  "done_at", "done_by_name", "late", "can_handle"]

    def get_person_name(self, task):
        return person(task.person) if task.person_id else None

    def get_can_handle(self, task):
        """Je peux cocher cette tâche ? (Un manager voit tout le départ de son collaborateur, mais coche seulement
        SES tâches.) Le résultat "RH de ce collaborateur" est gardé par personne : une seule requête par parcours."""
        request = self.context.get("request")
        if request is None:
            return True  # (MY tasks : toujours les miennes)
        user = request.user
        if user.is_superuser or (task.person_id and task.person.user_id == user.pk):
            return True
        memo = self.context.setdefault("_hr_of", {})
        employee = task.journey.employee
        if employee.pk not in memo:
            memo[employee.pk] = services.is_hr_of(user, employee)
        return memo[employee.pk]

    def get_done_by_name(self, task):
        return name_of(task.done_by) if task.done_by_id else None

    def get_late(self, task):
        return task.done_at is None and task.due_date < timezone.localdate()


class MyTaskSerializer(TaskSerializer):
    """Une de MES tâches, avec le parcours (qui arrive / part, et quand) : la page "My tasks" les groupe par parcours."""

    journey = serializers.SerializerMethodField()

    class Meta(TaskSerializer.Meta):
        fields = TaskSerializer.Meta.fields + ["journey"]

    def get_journey(self, task):
        journey = task.journey
        return {"id": journey.pk, "kind": journey.kind, "day": journey.day, "employee": employee_card(journey.employee)}


class JourneySerializer(serializers.ModelSerializer):
    """Un parcours, avec TOUTES ses tâches (le panneau des RH) et où il en est."""

    employee = serializers.SerializerMethodField()
    tasks = TaskSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    cancelled_by_name = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    departure = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = Journey
        fields = ["id", "kind", "day", "employee", "tasks", "status", "created_at", "created_by_name",
                  "cancelled_at", "cancelled_by_name", "cancel_reason", "departure", "can_cancel"]

    def get_departure(self, journey):
        """Un départ : la demande d'où il vient (type, lettre, qui l'a saisie, personnes prévenues)."""
        departure = getattr(journey, "departure", None) if journey.kind == "DEPARTURE" else None
        return DepartureSerializer(departure, context=self.context).data if departure else None  # context : can_decide_notice

    def get_can_cancel(self, journey):
        """Annuler : les RH du pôle seulement (un manager suit l'avancement)."""
        request = self.context.get("request")
        return request is not None and journey.cancelled_at is None and services.is_hr_of(request.user, journey.employee)

    def get_employee(self, journey):
        return employee_card(journey.employee)

    def get_created_by_name(self, journey):
        return name_of(journey.created_by) if journey.created_by_id else None

    def get_cancelled_by_name(self, journey):
        return name_of(journey.cancelled_by) if journey.cancelled_by_id else None

    def get_status(self, journey):
        """"cancelled", "done" (toutes les tâches faites) ou "open"."""
        if journey.cancelled_at:
            return "cancelled"
        return "done" if all(task.done_at for task in journey.tasks.all()) else "open"


class DepartureSerializer(serializers.ModelSerializer):
    """Une demande de départ : qui part, pourquoi, quand, la lettre, qui l'a saisie, où elle en est."""

    employee = serializers.SerializerMethodField()
    type_label = serializers.CharField(source="get_departure_type_display")
    status = serializers.CharField(source="request.status")
    requested_by_name = serializers.SerializerMethodField()
    informed = serializers.SerializerMethodField()
    has_letter = serializers.SerializerMethodField()
    # Le préavis (2026-11-25) : la photo prise à la demande, ce qui manque, et la décision des RH.
    notice_group_label = serializers.CharField(source="get_notice_group_display")
    notice_status_label = serializers.CharField(source="get_notice_status_display")
    notice_short_days = serializers.IntegerField(read_only=True)
    notice_decided_by_name = serializers.SerializerMethodField()
    can_decide_notice = serializers.SerializerMethodField()

    class Meta:
        model = Departure
        fields = ["id", "request", "employee", "departure_type", "type_label", "last_day", "comment", "has_letter",
                  "letter_name", "informed", "status", "requested_by_name", "created_at", "journey",
                  "notice_group", "notice_group_label", "notice_years", "notice_amount", "notice_unit", "notice_start",
                  "notice_until", "notice_short_days", "notice_status", "notice_status_label", "notice_decided_by_name",
                  "notice_decided_at", "can_decide_notice",
                  # La procédure complète (2026-11-25) : faute grave, l'original de la lettre, les documents de sortie,
                  # l'entretien de sortie (confidentiel : le collaborateur et les RH).
                  "serious_misconduct", "letter_original_at", "letter_original_by_name", "exit_request",
                  "can_see_exit_interview", "exit_interview_done", "current"]

    # Réembauche (2026-11-27) : un départ de la période ACTUELLE (pas celui d'avant la réembauche). "My departure"
    # ne montre que lui comme "en cours" ; les anciens restent dans la liste d'en dessous.
    current = serializers.SerializerMethodField()
    letter_original_by_name = serializers.SerializerMethodField()

    def get_current(self, departure):
        return departure.last_day >= departure.employee.hire_date
    can_see_exit_interview = serializers.SerializerMethodField()
    exit_interview_done = serializers.SerializerMethodField()

    def get_letter_original_by_name(self, departure):
        return name_of(departure.letter_original_by) if departure.letter_original_by_id else None

    def get_can_see_exit_interview(self, departure):
        request = self.context.get("request")
        return bool(request and services.can_see_exit_interview(request.user, departure))

    def get_exit_interview_done(self, departure):
        interview = getattr(departure, "exit_interview", None)
        return bool(interview and interview.filled_at)

    def get_notice_decided_by_name(self, departure):
        return name_of(departure.notice_decided_by) if departure.notice_decided_by_id else None

    def get_can_decide_notice(self, departure):
        """Les RH de son pôle (Admin RH, IT) décident du préavis ; le manager et le collaborateur le voient seulement."""
        request = self.context.get("request")
        return bool(request and is_hr_of(request.user, departure.employee))

    def get_employee(self, departure):
        return employee_card(departure.employee)

    def get_requested_by_name(self, departure):
        who = departure.request.initiated_by
        return name_of(who) if who else person(departure.employee)

    def get_informed(self, departure):
        return [person(employee) for employee in departure.informed.all()]

    def get_has_letter(self, departure):
        return bool(departure.letter)


class JourneySettingsSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()
    # Le préavis : les types de départ où il s'applique (des codes de DepartureType), les catégories "cadres".
    notice_types = serializers.ListField(child=serializers.ChoiceField(choices=DepartureType.choices), required=False)
    executive_categories = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=Category.objects.all())
    exit_document_types = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=DocumentType.objects.all())

    class Meta:
        model = JourneySettings
        fields = ["employee_can_request_departure", "auto_block", "notice_types", "executive_categories",
                  "letter_required", "indemnity_hours", "indemnity_min_months", "exit_document_types", "exit_document_days",
                  "auto_cancel_leaves", "exit_interview_enabled", "show_payroll", "rehire_keep_seniority",
                  "updated_at", "updated_by_name"]
        read_only_fields = ["updated_at"]
        extra_kwargs = {"indemnity_min_months": {"min_value": 0, "max_value": 60},
                        "exit_document_days": {"min_value": 0, "max_value": 60}}

    def get_updated_by_name(self, current):
        return name_of(current.updated_by) if current.updated_by_id else None

    def validate_notice_types(self, value):
        return list(dict.fromkeys(value))  # sans doublon, dans l'ordre

    def validate_indemnity_hours(self, value):
        """[[à partir de (années), heures par an], ...] : des nombres >= 0, la première tranche à 0 an, sans doublon."""
        try:
            rows = sorted((float(start), float(hours)) for start, hours in value)
        except (TypeError, ValueError):
            raise serializers.ValidationError("Chaque tranche : [à partir de (années), heures par an].")
        if not rows or rows[0][0] != 0 or any(start < 0 or hours < 0 or hours > 1000 for start, hours in rows) \
                or len({start for start, _ in rows}) != len(rows):
            raise serializers.ValidationError("La première tranche commence à 0 an ; des nombres positifs, sans doublon.")
        return [[int(start) if start.is_integer() else start, int(hours) if hours.is_integer() else hours] for start, hours in rows]


class ExitQuestionSerializer(serializers.ModelSerializer):
    """Une question de l'entretien de sortie (Admin RH). Un choix : au moins 2 réponses possibles."""

    class Meta:
        model = ExitQuestion
        fields = ["id", "text", "kind", "choices", "required", "order", "is_active"]

    def validate(self, data):
        kind = data.get("kind", getattr(self.instance, "kind", "TEXT"))
        choices = [str(choice).strip() for choice in data.get("choices", getattr(self.instance, "choices", [])) if str(choice).strip()]
        if kind == "CHOICE" and len(choices) < 2:
            raise serializers.ValidationError({"choices": "Donnez au moins 2 choix."})
        data["choices"] = choices if kind == "CHOICE" else []
        if "text" in data:
            data["text"] = data["text"].strip()
        return data


class NoticeRuleSerializer(serializers.ModelSerializer):
    """Une case de la grille du préavis : Admin RH change la durée et l'unité (les 6 lignes sont fixes)."""

    group_label = serializers.CharField(source="get_group_display", read_only=True)

    class Meta:
        model = NoticeRule
        fields = ["id", "group", "group_label", "min_years", "amount", "unit"]
        read_only_fields = ["group", "min_years"]


class TaskTemplateSerializer(serializers.ModelSerializer):
    """Une ligne du modèle (Admin RH). `person` = l'id d'un collaborateur, seulement pour "Une personne choisie"."""

    person_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskTemplate
        fields = ["id", "kind", "name", "owner", "person", "person_name", "offset_days", "detail_label", "is_active"]

    def get_person_name(self, template):
        return person(template.person) if template.person_id else None

    def validate(self, attrs):
        # Les règles du modèle : une personne pour "Une personne choisie", jamais une personne sortie.
        # (Une modification n'envoie que ce qui change : le reste est lu dans la ligne actuelle.)
        current = lambda field, default=None: attrs.get(field, getattr(self.instance, field, default))  # noqa: E731
        name, owner, chosen = " ".join(str(current("name", "")).split()), current("owner"), current("person")
        if not name:
            raise serializers.ValidationError({"name": "Indiquez la tâche."})
        if owner == Owner.PERSON and chosen is None:
            raise serializers.ValidationError({"person": "Choisissez la personne qui fait cette tâche."})
        if owner == Owner.PERSON and chosen.status == Employee.Status.LEFT:
            raise serializers.ValidationError({"person": "Cette personne est sortie : choisissez quelqu'un d'autre."})
        attrs["name"] = name
        if owner != Owner.PERSON:
            attrs["person"] = None  # une personne seulement pour "Une personne choisie"
        return attrs
