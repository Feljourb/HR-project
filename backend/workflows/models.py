"""
Le "tableau" des circuits de validation : pour chaque type de demande,
qui doit valider, et dans quel ordre.

Exemple :  Congé annuel  ->  1. N+1   2. RH du pôle
"""
from django.db import models

from employees.models import ReferenceItem


class Workflow(ReferenceItem):
    """Un type de demande (ex. "Attestation de travail") et son circuit.
    Hérite de ReferenceItem : un nom unique, et "désactivé" au lieu de supprimé
    (les anciennes demandes gardent leur circuit)."""

    class Meta(ReferenceItem.Meta):
        verbose_name = "Circuit de validation"
        verbose_name_plural = "Circuits de validation"


class WorkflowStep(models.Model):
    """Une étape du circuit : "en position 1, le N+1 valide"."""

    class Approver(models.TextChoices):
        # Une étape dit QUI valide (un rôle), jamais une personne précise :
        # le N+1 de Karim n'est pas le N+1 de Sara.
        MANAGER = "MANAGER", "N+1"
        MANAGER_2 = "MANAGER_2", "N+2"
        HR = "HR", "RH du pôle"
        HR_ADMIN = "HR_ADMIN", "Admin RH"

    # CASCADE : sans son circuit, une étape n'a pas de sens (et un circuit n'est jamais supprimé).
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="steps", verbose_name="Circuit")
    order = models.PositiveSmallIntegerField("Ordre")
    approver = models.CharField("Validé par", max_length=20, choices=Approver.choices)

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
        return f"{self.workflow} - {self.order}. {self.get_approver_display()}"
