"""Les circuits en JSON, pour l'écran "Workflows" d'Admin RH."""
from django.db import transaction
from rest_framework import serializers

from employees.models import Pole
from employees.serializers import ReferenceSerializer, check_model_rules, preview

from .models import Request, RequestStep, Workflow, WorkflowStep


class StepSerializer(serializers.ModelSerializer):
    """Une étape : {"order": 1, "approver": "MANAGER", "approver_label": "N+1", "mode": "VALIDATE", ...}."""

    # Le texte à afficher ("N+1", "Valider"), pour que le frontend n'ait pas à le traduire.
    approver_label = serializers.CharField(source="get_approver_display", read_only=True)
    mode_label = serializers.CharField(source="get_mode_display", read_only=True)

    class Meta:
        model = WorkflowStep
        fields = ["order", "approver", "approver_label", "mode", "mode_label"]
        # L'ordre n'est jamais envoyé : c'est la place de l'étape dans la liste (voir update).
        read_only_fields = ["order"]


class WorkflowSerializer(serializers.ModelSerializer):
    """Un circuit et ses étapes. On envoie TOUTE la liste des étapes, dans le nouvel ordre."""

    steps = StepSerializer(many=True)

    class Meta:
        model = Workflow
        fields = ["id", "code", "name", "is_active", "steps"]
        # Le code ne change jamais : chaque module retrouve son circuit avec lui.
        read_only_fields = ["code"]

    def validate_steps(self, steps):
        # Dans un PATCH, DRF rend TOUS les champs facultatifs, même ceux des étapes :
        # on vérifie donc nous-mêmes que chaque étape a son valideur et son mode.
        if any("approver" not in step or "mode" not in step for step in steps):
            raise serializers.ValidationError("Chaque étape a besoin d'un valideur et d'un mode.")
        # Sans étape "Valider", personne ne répond : toutes les demandes seraient acceptées toutes seules.
        if not any(step["mode"] == WorkflowStep.Mode.VALIDATE for step in steps):
            raise serializers.ValidationError("Le circuit doit avoir au moins une étape « Valider ».")
        # La même règle que la base de données, mais avec un message clair avant d'enregistrer.
        approvers = [step["approver"] for step in steps]
        if len(set(approvers)) != len(approvers):
            raise serializers.ValidationError("Ce valideur est déjà dans le circuit.")
        return steps

    def validate(self, attrs):
        # Les règles du modèle (nom unique sans majuscules...). Les étapes sont vérifiées au-dessus.
        check_model_rules(preview(self, attrs, skip=["steps"]))
        return attrs

    @transaction.atomic
    def update(self, workflow, validated_data):
        steps = validated_data.pop("steps", None)
        workflow = super().update(workflow, validated_data)
        # PATCH sans "steps" (ex. seulement renommer) : les étapes ne bougent pas.
        if steps is not None:
            # On remplace tout : supprimer les anciennes étapes, créer les nouvelles numérotées 1, 2, 3...
            # Sans risque : une demande déjà envoyée garde SA copie du circuit (step 4).
            # transaction.atomic : si une création échoue, la suppression est annulée aussi.
            workflow.steps.all().delete()
            WorkflowStep.objects.bulk_create(
                WorkflowStep(workflow=workflow, order=order, **step)
                for order, step in enumerate(steps, start=1)
            )
        return workflow


# --- Le DG de chaque pôle (step 3b) ----------------------------------------------------------
# ReferenceSerializer (app employees) lance les règles du modèle (ex. pas de DG "Sorti").

class PoleDirectorSerializer(ReferenceSerializer):
    """Un pôle et son DG : {"id": 1, "name": "SBD", "director": 7, "director_label": "U000007 - BADAA Soufiane"}.
    Le DG est un collaborateur (son numéro de dossier). Seul le DG se change ici
    (le nom du pôle se change dans la page des listes)."""

    director_label = serializers.StringRelatedField(source="director")

    class Meta:
        model = Pole
        fields = ["id", "name", "director", "director_label"]
        read_only_fields = ["name"]


# --- Les demandes (step 6a) ------------------------------------------------------------

def person(employee):
    """ "Sara Alami" : le nom affiché dans les pages (sans le matricule)."""
    return f"{employee.first_name} {employee.last_name.title()}"


class RequestStepSerializer(serializers.ModelSerializer):
    """Une étape d'une demande, pour la suivre : qui doit répondre, et ce qui s'est passé."""

    approver_label = serializers.CharField(source="get_approver_display")
    mode_label = serializers.CharField(source="get_mode_display")
    status_label = serializers.CharField(source="get_status_display")
    validator = serializers.SerializerMethodField()
    decided_by = serializers.SerializerMethodField()

    class Meta:
        model = RequestStep
        fields = ["order", "approver", "approver_label", "mode", "mode_label", "status", "status_label",
                  "validator", "decided_by", "decided_at", "comment"]

    def get_validator(self, step):
        # Qui doit répondre : "Youssef Bennani" (N+1, N+2 ou DG), ou "RH du pôle" (n'importe quel RH).
        if step.assignee:
            return person(step.assignee)
        return step.get_approver_display()

    def get_decided_by(self, step):
        # Le compte qui a répondu (ex. "hind.rh"), ou null (pas encore, ou étape sautée / informée).
        return step.decided_by.username if step.decided_by else None


class RequestSerializer(serializers.ModelSerializer):
    """Une demande et son circuit : pour "My requests" (le demandeur) et "Team approvals" (le valideur)."""

    workflow = serializers.CharField(source="workflow.name")
    workflow_code = serializers.CharField(source="workflow.code")
    requester = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display")
    steps = RequestStepSerializer(many=True)

    class Meta:
        model = Request
        fields = ["id", "workflow", "workflow_code", "title", "requester", "status", "status_label",
                  "created_at", "closed_at", "steps"]

    def get_requester(self, request):
        return person(request.requester)


class ApprovalSerializer(serializers.ModelSerializer):
    """Une étape qui attend MA réponse, avec sa demande. L'id est celui de l'ÉTAPE
    (c'est elle qu'on valide ou refuse)."""

    request = RequestSerializer()
    approver_label = serializers.CharField(source="get_approver_display")

    class Meta:
        model = RequestStep
        fields = ["id", "approver", "approver_label", "request"]


class DecisionSerializer(serializers.Serializer):
    """Ce qu'on envoie pour répondre : {"comment": "..."} (obligatoire pour refuser : le moteur le vérifie)."""

    comment = serializers.CharField(required=False, allow_blank=True, default="", max_length=1000)