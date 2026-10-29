"""Les circuits en JSON, pour l'écran "Workflows" d'Admin RH."""
from django.db import transaction
from rest_framework import serializers

from employees.models import Director, Pole
from employees.serializers import ReferenceSerializer, check_model_rules, preview

from .models import Workflow, WorkflowStep


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


# --- DG (step 3b) ----------------------------------------------------------------
# ReferenceSerializer (app employees) lance les règles du modèle : nom unique, DG encore utilisé...

class DirectorSerializer(ReferenceSerializer):
    """Un DG : {"id": 1, "name": "Soufiane Badaa", "email": "...", "is_active": true}."""

    class Meta:
        model = Director
        fields = ["id", "name", "email", "is_active"]


class PoleDirectorSerializer(ReferenceSerializer):
    """Un pôle et son DG : {"id": 1, "name": "SBD", "director": 1}. Seul le DG se change ici
    (le nom du pôle se change dans la page des listes)."""

    class Meta:
        model = Pole
        fields = ["id", "name", "director"]
        read_only_fields = ["name"]