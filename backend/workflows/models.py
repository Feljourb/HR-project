"""
La configuration des circuits de validation : pour chaque type de demande,
quelles étapes, dans quel ordre, et pour chaque étape : valider ou seulement informer.

Exemple :  Congé  ->  1. N+1 valide   2. RH est informée
"""
from django.db import models

from employees.models import ReferenceItem


class Workflow(ReferenceItem):
    """Un type de demande (ex. "Congé") et son circuit.
    Hérite de ReferenceItem : un nom unique, et "désactivé" au lieu de supprimé."""

    class Code(models.TextChoices):
        # Chaque module retrouve SON circuit par ce code, jamais par le nom :
        # si Admin RH renomme "Congé" en "Congés payés", rien ne casse.
        LEAVE = "LEAVE", "Congé"
        EXPENSE = "EXPENSE", "Note de frais"
        ADMIN_REQUEST = "ADMIN_REQUEST", "Demande administrative"

    code = models.CharField("Code", max_length=30, choices=Code.choices, unique=True)

    class Meta(ReferenceItem.Meta):
        verbose_name = "Circuit de validation"
        verbose_name_plural = "Circuits de validation"


class WorkflowStep(models.Model):
    """Une étape du circuit : "en position 1, le N+1 valide"."""

    class Approver(models.TextChoices):
        # Un RÔLE, jamais une personne : le N+1 de Sara n'est pas le N+1 de Karim.
        # Admin RH n'est pas un valideur (il configure seulement).
        MANAGER = "MANAGER", "N+1"
        MANAGER_2 = "MANAGER_2", "N+2"
        HR = "HR", "RH du pôle"
        DG = "DG", "DG du pôle"

    class Mode(models.TextChoices):
        VALIDATE = "VALIDATE", "Valider"   # la demande attend sa réponse
        INFORM = "INFORM", "Informer"      # une notification, et on passe à la suite

    # CASCADE : sans son circuit, une étape n'a pas de sens (et un circuit n'est jamais supprimé).
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="steps", verbose_name="Circuit")
    order = models.PositiveSmallIntegerField("Ordre")
    approver = models.CharField("Valideur", max_length=20, choices=Approver.choices)
    mode = models.CharField("Mode", max_length=10, choices=Mode.choices, default=Mode.VALIDATE)

    class Meta:
        ordering = ["workflow", "order"]
        verbose_name = "Étape"
        constraints = [
            # Deux étapes "en position 1" dans le même circuit : on ne saurait pas laquelle passe d'abord.
            models.UniqueConstraint(
                "workflow", "order",
                name="workflows_step_unique_order",
                violation_error_message="Il y a déjà une étape à cette position.",
            ),
            # Le même valideur deux fois (N+1 puis N+1) ne sert à rien.
            models.UniqueConstraint(
                "workflow", "approver",
                name="workflows_step_unique_approver",
                violation_error_message="Ce valideur est déjà dans le circuit.",
            ),
            # L'ordre commence à 1.
            models.CheckConstraint(
                condition=models.Q(order__gte=1),
                name="workflows_step_order_positive",
                violation_error_message="L'ordre commence à 1.",
            ),
        ]

    def __str__(self):
        return f"{self.workflow} - {self.order}. {self.get_approver_display()} ({self.get_mode_display()})"
