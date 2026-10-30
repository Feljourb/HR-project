"""
La configuration des circuits de validation : pour chaque type de demande,
quelles étapes, dans quel ordre, et pour chaque étape : valider ou seulement informer.

Exemple :  Congé  ->  1. N+1 valide   2. RH est informée
"""
from django.conf import settings
from django.db import models

from employees.models import Director, Employee, ReferenceItem


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


# --- Les demandes (step 4) ----------------------------------------------------------

class Request(models.Model):
    """Une demande (ex. le congé de Sara) qui suit son circuit.
    Le moteur ne sait rien des congés : le module Congé garde ses propres infos (dates...)
    dans sa table, qui pointe vers cette demande."""

    class Status(models.TextChoices):
        IN_PROGRESS = "IN_PROGRESS", "En cours"
        APPROVED = "APPROVED", "Acceptée"
        REJECTED = "REJECTED", "Refusée"
        CANCELLED = "CANCELLED", "Annulée"

    # PROTECT : une demande ne perd jamais son circuit ni son demandeur.
    workflow = models.ForeignKey(Workflow, on_delete=models.PROTECT, related_name="requests", verbose_name="Circuit")
    requester = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="requests", verbose_name="Demandeur")
    # Donné par le module, pour l'afficher dans les listes : "Congé du 10 au 15 novembre".
    title = models.CharField("Titre", max_length=200)
    status = models.CharField("Statut", max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    created_at = models.DateTimeField("Envoyée le", auto_now_add=True)
    closed_at = models.DateTimeField("Terminée le", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]  # la plus récente d'abord
        verbose_name = "Demande"

    def __str__(self):
        return f"{self.title} ({self.requester})"


class RequestStep(models.Model):
    """Une étape d'UNE demande : la COPIE d'une étape du circuit, faite à l'envoi.
    Si Admin RH change le circuit ensuite, cette copie ne bouge pas.
    Elle garde aussi l'historique : qui a décidé, quand, avec quel commentaire."""

    class Status(models.TextChoices):
        WAITING = "WAITING", "Pas encore son tour"
        PENDING = "PENDING", "À traiter"          # c'est le tour de cette étape
        APPROVED = "APPROVED", "Validée"
        REJECTED = "REJECTED", "Refusée"
        INFORMED = "INFORMED", "Informée"
        SKIPPED = "SKIPPED", "Sautée"             # personne à ce poste (ex. pas de N+2)

    request = models.ForeignKey(Request, on_delete=models.CASCADE, related_name="steps", verbose_name="Demande")
    # La copie de l'étape du circuit.
    order = models.PositiveSmallIntegerField("Ordre")
    approver = models.CharField("Valideur", max_length=20, choices=WorkflowStep.Approver.choices)
    mode = models.CharField("Mode", max_length=10, choices=WorkflowStep.Mode.choices)

    # QUI exactement, trouvé à l'envoi :
    # - N+1 / N+2 : un collaborateur (assignee) ;
    # - DG : un DG (director), qui n'est pas un collaborateur ;
    # - RH : personne en particulier (les deux vides) : n'importe quel RH du pôle, sauf le demandeur ;
    #   s'il n'y a aucun autre RH dans le pôle, Admin RH le remplace (hr_admin_replaces).
    assignee = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="+", verbose_name="Valideur (collaborateur)")
    director = models.ForeignKey(Director, on_delete=models.PROTECT, null=True, blank=True, related_name="+", verbose_name="Valideur (DG)")
    # Pas un valideur des circuits : seulement un remplaçant, quand le pôle n'a pas d'autre RH.
    hr_admin_replaces = models.BooleanField("Admin RH remplace la RH", default=False)

    status = models.CharField("Statut", max_length=10, choices=Status.choices, default=Status.WAITING)
    # L'historique de l'étape. SET_NULL : si un compte disparaît, la ligne reste.
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="Décidé par")
    decided_at = models.DateTimeField("Décidé le", null=True, blank=True)
    comment = models.TextField("Commentaire", blank=True)

    class Meta:
        ordering = ["request", "order"]
        verbose_name = "Étape de demande"
        constraints = [
            models.UniqueConstraint("request", "order", name="workflows_requeststep_unique_order"),
        ]

    def __str__(self):
        return f"{self.request} - {self.order}. {self.get_approver_display()} ({self.get_status_display()})"