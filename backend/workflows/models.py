"""
La configuration des circuits de validation : pour chaque type de demande,
quelles étapes, dans quel ordre, et pour chaque étape : valider ou seulement informer.

Exemple :  Congé  ->  1. N+1 valide   2. RH est informée
"""
from django.conf import settings
from django.db import models

from employees.models import Employee, ReferenceItem


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
    # Qui a annulé, et pourquoi (une demande ACCEPTÉE peut être annulée par le demandeur ou les RH, avec un motif).
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+", verbose_name="Annulée par")
    cancel_reason = models.TextField("Motif de l'annulation", blank=True)

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
    # - N+1 / N+2 / DG : un collaborateur (le DG est un collaborateur comme les autres) ;
    # - RH : personne en particulier (vide) : n'importe quel RH du pôle ou Admin RH, sauf le demandeur.
    assignee = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="+", verbose_name="Valideur")

    status = models.CharField("Statut", max_length=10, choices=Status.choices, default=Status.WAITING)
    # L'historique de l'étape. SET_NULL : si un compte disparaît, la ligne reste.
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="Décidé par")
    decided_at = models.DateTimeField("Décidé le", null=True, blank=True)
    comment = models.TextField("Commentaire", blank=True)
    # P2 step 1 : la personne attendue (assignee) était absente, quelqu'un a répondu À SA PLACE (son délégué,
    # son responsable, ou un RH) : l'historique dit "Validée par Karim pour Youssef".
    on_behalf_of = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="+",
                                     verbose_name="Pour (absent)")

    class Meta:
        ordering = ["request", "order"]
        verbose_name = "Étape de demande"
        constraints = [
            models.UniqueConstraint("request", "order", name="workflows_requeststep_unique_order"),
        ]

    def __str__(self):
        return f"{self.request} - {self.order}. {self.get_approver_display()} ({self.get_status_display()})"


def can_be_delegate(delegate, delegator):
    """Qui peut remplacer un valideur absent : N'IMPORTE QUI du même pôle que l'absent (une Admin RH : les deux
    pôles), au choix de l'absent (décision de l'utilisateur, 2026-11-12 ; avant : seulement Manager / RH / Admin RH).
    Toujours : jamais pour sa propre demande (engine.stand_in), et l'historique dit "on behalf of"."""
    return delegate.user.role == "HR_ADMIN" or delegate.pole == delegator.pole


class Delegation(models.Model):
    """P2 step 1 : une absence PRÉVUE d'un valideur, comme un message "absent du bureau" (standard des logiciels RH).
    Ex. "Du 10/11 au 20/11, les demandes de Youssef vont aussi à Karim." Pendant la période, Karim répond à la place
    de Youssef (et Youssef peut toujours répondre). Choisie par Youssef lui-même, ou par les RH pour lui
    (ex. une hospitalisation). Jamais supprimée : "End now" la termine (ended_at), elle reste dans l'historique."""

    delegator = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="delegations_given", verbose_name="Absent")
    delegate = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="delegations_received", verbose_name="Remplaçant")
    start_date = models.DateField("Du")
    end_date = models.DateField("Au")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+", verbose_name="Créée par")
    created_at = models.DateTimeField("Créée le", auto_now_add=True)
    ended_at = models.DateTimeField("Terminée le", null=True, blank=True)  # "End now" : plus valable

    class Meta:
        ordering = ["-start_date", "-id"]
        verbose_name = "Délégation"

    def __str__(self):
        return f"{self.delegator} -> {self.delegate} ({self.start_date:%d/%m/%Y} - {self.end_date:%d/%m/%Y})"

    def clean(self):
        from django.core.exceptions import ValidationError
        from django.utils import timezone

        if not (self.delegator_id and self.delegate_id and self.start_date and self.end_date):
            return
        if self.delegate_id == self.delegator_id:
            raise ValidationError({"delegate": "Choisissez une autre personne que l'absent."})
        if self.delegate.status == Employee.Status.LEFT or not self.delegate.user.is_active:
            raise ValidationError({"delegate": "Ce collaborateur n'est plus actif."})
        # Quelqu'un du même pôle (Admin RH : les deux pôles), au choix de l'absent (décision du 2026-11-12).
        if not can_be_delegate(self.delegate, self.delegator):
            raise ValidationError({"delegate": "Choisissez quelqu'un du même pôle que l'absent."})
        if self.end_date < self.start_date:
            raise ValidationError({"end_date": "La fin est avant le début."})
        if self.end_date < timezone.localdate():
            raise ValidationError({"end_date": "Cette période est déjà passée."})
        if (self.end_date - self.start_date).days > 366:
            raise ValidationError({"end_date": "Au plus un an."})
        # Une seule délégation à la fois pour un même absent (sinon : à qui vont ses demandes ?).
        overlap = (Delegation.objects.filter(delegator=self.delegator_id, ended_at__isnull=True,
                                             start_date__lte=self.end_date, end_date__gte=self.start_date)
                   .exclude(pk=self.pk).first())
        if overlap:
            raise ValidationError(f"Une délégation existe déjà sur ces dates ({overlap.start_date:%d/%m/%Y} - "
                                  f"{overlap.end_date:%d/%m/%Y}, vers {overlap.delegate}).")