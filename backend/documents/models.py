"""Le module Documents administratifs (app documents, 2026-11-12).

Standard des logiciels RH (Workday, SAP, BambooHR) : le collaborateur DEMANDE un document (attestation de travail,
de salaire...), les RH de son pôle VALIDENT (le circuit "Demande administrative" du moteur), puis il le TÉLÉCHARGE :
- un type avec un modèle (template, ex. l'attestation de travail) : l'application génère le PDF toute seule, à la
  validation, avec les données de la fiche ;
- un type sans modèle (ex. attestation de salaire : le salaire n'est pas dans l'application) : les RH déposent
  le PDF signé après la validation.
Comme les congés et les notes de frais : le statut n'est pas ici, on le lit dans request.status (le moteur).
"""
import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone

from employees.models import Employee, Pole, ReferenceItem
from workflows.models import Request

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 Mo : un PDF scanné


class DocumentType(ReferenceItem):
    """Un type de document qu'on peut demander. Comme les autres listes : jamais supprimé, seulement désactivé."""

    class Template(models.TextChoices):
        # Le modèle de PDF que l'APPLICATION remplit (écrit dans documents/pdf.py). Vide : les RH préparent le document.
        NONE = "", "Aucun : préparé par les RH"
        WORK = "WORK", "Attestation de travail (générée)"

    template = models.CharField("Modèle", max_length=10, choices=Template.choices, default=Template.NONE, blank=True)

    class Meta(ReferenceItem.Meta):
        verbose_name = "Type de document"
        verbose_name_plural = "Types de document"


class DocumentSignatory(models.Model):
    """Qui signe les documents générés, par pôle (ex. "Le Directeur des Ressources Humaines", son nom, la ville du
    "Fait à"). Valeurs de départ : PROPOSITION, à confirmer par les RH (dans /admin)."""

    pole = models.OneToOneField(Pole, on_delete=models.PROTECT, related_name="document_signatory", verbose_name="Pôle")
    name = models.CharField("Nom du signataire", max_length=150, blank=True)  # vide : seulement la fonction
    title = models.CharField("Fonction", max_length=150, default="Le Directeur des Ressources Humaines")
    city = models.CharField("Ville (« Fait à »)", max_length=100, default="Casablanca")

    class Meta:
        verbose_name = "Signataire des documents"
        verbose_name_plural = "Signataires des documents"

    def __str__(self):
        return f"{self.pole} : {self.title}"


def document_path(document, filename):
    """documents/2026/11/<nom au hasard>.pdf : on ne devine pas l'adresse d'un fichier (comme les justificatifs)."""
    return f"documents/{timezone.localdate():%Y/%m}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


def document_size(file):
    if file.size > MAX_FILE_SIZE:
        raise ValidationError("Le document dépasse 5 Mo.")


class DocumentRequest(models.Model):
    """Une demande de document, attachée à une demande du moteur (son circuit, son historique, son statut)."""

    request = models.OneToOneField(Request, on_delete=models.CASCADE, related_name="document", verbose_name="Demande")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="document_requests", verbose_name="Collaborateur")
    doc_type = models.ForeignKey(DocumentType, on_delete=models.PROTECT, related_name="requests", verbose_name="Type")
    purpose = models.CharField("Motif / destinataire", max_length=200, blank=True)  # ex. "Banque", "Visa"
    # Le document livré : généré par l'application, ou déposé par un RH. Jamais servi par une adresse publique.
    reference = models.CharField("Référence", max_length=30, unique=True, null=True, blank=True)
    file = models.FileField("Fichier", upload_to=document_path, blank=True,
                            validators=[FileExtensionValidator(["pdf"]), document_size])
    file_name = models.CharField("Nom du fichier", max_length=200, blank=True)
    delivered_at = models.DateTimeField("Livré le", null=True, blank=True)
    # Le RH qui a déposé le fichier ; vide pour un document généré par l'application.
    delivered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+", verbose_name="Déposé par")

    class Meta:
        ordering = ["-id"]
        verbose_name = "Demande de document"
        verbose_name_plural = "Demandes de document"

    def __str__(self):
        return f"{self.doc_type} ({self.employee})"

    @property
    def state(self):
        """Où en est la demande, pour les pages : IN_PROGRESS (à valider), TO_PREPARE (validée, les RH préparent),
        READY (à télécharger), REJECTED, CANCELLED."""
        status = self.request.status
        if status == Request.Status.APPROVED:
            return "READY" if self.file else "TO_PREPARE"
        return status
