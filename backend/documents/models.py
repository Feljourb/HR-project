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
from django.core.validators import FileExtensionValidator, MaxValueValidator
from django.db import models
from django.db.models import Q
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
    # Le délai promis (standard "SLA") : le document est prêt au plus tard N jours OUVRÉS après la demande (lundi ->
    # vendredi, sans les jours fériés). 0 = tout de suite (un document généré). Valeurs de départ : à confirmer par les RH.
    delivery_days = models.PositiveSmallIntegerField("Délai (jours ouvrés)", default=2,
                                                     validators=[MaxValueValidator(30)])

    class Meta(ReferenceItem.Meta):
        verbose_name = "Type de document"
        verbose_name_plural = "Types de document"


def signature_path(signatory, filename):
    """signatures/<nom au hasard>.png : jamais une adresse publique (seulement dans les PDF générés)."""
    return f"signatures/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


def image_size(file):
    if file.size > 1024 * 1024:
        raise ValidationError("L'image dépasse 1 Mo.")


IMAGE_RULES = [FileExtensionValidator(["png", "jpg", "jpeg"]), image_size]


class DocumentSignatory(models.Model):
    """Qui signe les documents générés, par pôle, et COMMENT (réglé par Admin RH, standard Workday / SAP) :
    - HAND : le PDF garde une place vide, les RH signent et tamponnent à la main (imprimé) ;
    - IMAGE : l'application pose la signature et le cachet (images données une fois par les RH) sur chaque PDF,
      seulement APRÈS la validation des RH. Il faut l'accord du signataire pour utiliser sa signature.
    Valeurs de départ : PROPOSITION, à confirmer par les RH."""

    class Mode(models.TextChoices):
        HAND = "HAND", "À signer à la main"
        IMAGE = "IMAGE", "Signature et cachet ajoutés par l'application"

    pole = models.OneToOneField(Pole, on_delete=models.PROTECT, related_name="document_signatory", verbose_name="Pôle")
    name = models.CharField("Nom du signataire", max_length=150, blank=True)  # vide : seulement la fonction
    title = models.CharField("Fonction", max_length=150, default="Le Directeur des Ressources Humaines")
    city = models.CharField("Ville (« Fait à »)", max_length=100, default="Casablanca")
    mode = models.CharField("Signature", max_length=5, choices=Mode.choices, default=Mode.HAND)
    signature = models.FileField("Image de la signature", upload_to=signature_path, blank=True, validators=IMAGE_RULES)
    stamp = models.FileField("Image du cachet", upload_to=signature_path, blank=True, validators=IMAGE_RULES)
    updated_at = models.DateTimeField("Modifié le", auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+", verbose_name="Modifié par")

    class Meta:
        verbose_name = "Signataire des documents"
        verbose_name_plural = "Signataires des documents"

    def __str__(self):
        return f"{self.pole} : {self.title}"

    def clean(self):
        # "Signature et cachet ajoutés" sans la signature : le PDF sortirait sans rien, on le dit tout de suite.
        if self.mode == self.Mode.IMAGE and not self.signature:
            raise ValidationError({"signature": "Ajoutez l'image de la signature pour ce mode."})


def document_path(document, filename):
    """documents/2026/11/<nom au hasard>.pdf : on ne devine pas l'adresse d'un fichier (comme les justificatifs)."""
    return f"documents/{timezone.localdate():%Y/%m}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


def document_size(file):
    if file.size > MAX_FILE_SIZE:
        raise ValidationError("Le document dépasse 5 Mo.")


class DocumentRequest(models.Model):
    """Une demande de document, attachée à une demande du moteur (son circuit, son historique, son statut)."""

    class Format(models.TextChoices):
        # Ce que veut le collaborateur (standard : c'est lui qui sait à qui il donne le document ; une banque ou un
        # consulat demande souvent l'ORIGINAL signé et tamponné à la main). Décision de l'utilisateur, 2026-11-13.
        PDF = "PDF", "PDF à télécharger"
        ORIGINAL = "ORIGINAL", "Original signé (à récupérer au bureau RH)"
        BOTH = "BOTH", "PDF + original signé"

    request = models.OneToOneField(Request, on_delete=models.CASCADE, related_name="document", verbose_name="Demande")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="document_requests", verbose_name="Collaborateur")
    doc_type = models.ForeignKey(DocumentType, on_delete=models.PROTECT, related_name="requests", verbose_name="Type")
    purpose = models.CharField("Motif / destinataire", max_length=200, blank=True)  # ex. "Banque", "Visa"
    format = models.CharField("Format", max_length=8, choices=Format.choices, default=Format.PDF)
    # Le RH qui a fait la demande POUR le collaborateur (champ "Employé (RH)" de l'outil actuel) ; vide : lui-même.
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+", verbose_name="Demandé par (RH)")
    # Prêt au plus tard le (date de la demande + le délai du type, en jours ouvrés) : "Expected by 16/11".
    due_date = models.DateField("Prévu pour le", null=True, blank=True)
    # Le document livré : généré par l'application, ou déposé par un RH. Jamais servi par une adresse publique.
    reference = models.CharField("Référence", max_length=30, unique=True, null=True, blank=True)
    file = models.FileField("Fichier", upload_to=document_path, blank=True,
                            validators=[FileExtensionValidator(["pdf"]), document_size])
    file_name = models.CharField("Nom du fichier", max_length=200, blank=True)
    delivered_at = models.DateTimeField("Livré le", null=True, blank=True)
    # Le RH qui a déposé le fichier ; vide pour un document généré par l'application.
    delivered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+", verbose_name="Déposé par")
    # L'original papier (format ORIGINAL ou BOTH, step 2 du 2026-11-13) : signé et tamponné à la main par les RH,
    # récupéré au bureau RH. Deux moments, avec qui : "prêt" (le collaborateur est prévenu), puis "remis".
    original_ready_at = models.DateTimeField("Original prêt le", null=True, blank=True)
    original_ready_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                          related_name="+", verbose_name="Original préparé par")
    collected_at = models.DateTimeField("Original remis le", null=True, blank=True)
    collected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+", verbose_name="Original remis par")

    class Meta:
        ordering = ["-id"]
        verbose_name = "Demande de document"
        verbose_name_plural = "Demandes de document"

    def __str__(self):
        return f"{self.doc_type} ({self.employee})"

    @property
    def needs_pdf(self):
        return self.format in (self.Format.PDF, self.Format.BOTH)

    @property
    def needs_original(self):
        return self.format in (self.Format.ORIGINAL, self.Format.BOTH)

    @property
    def state(self):
        """Où en est la demande, pour les pages : IN_PROGRESS (à valider), TO_PREPARE (validée, les RH ont encore
        quelque chose à faire : le PDF à déposer et / ou l'original à signer), PICKUP (l'original attend au bureau
        RH), READY (tout est livré), REJECTED, CANCELLED."""
        status = self.request.status
        if status != Request.Status.APPROVED:
            return status
        if (self.needs_pdf and not self.file) or (self.needs_original and not self.original_ready_at):
            return "TO_PREPARE"
        if self.needs_original and not self.collected_at:
            return "PICKUP"
        return "READY"

    @property
    def original_state(self):
        """L'original papier seul : None (pas demandé), TO_SIGN, PICKUP (prêt au bureau RH) ou COLLECTED."""
        if not self.needs_original or self.request.status != Request.Status.APPROVED:
            return None
        if self.collected_at:
            return "COLLECTED"
        return "PICKUP" if self.original_ready_at else "TO_SIGN"

    # Les mêmes règles que `state`, en filtre SQL (listes des RH, "une demande en cours par type").
    @classmethod
    def to_prepare_filter(cls):
        """Validée, et les RH ont encore à faire : le PDF à déposer et / ou l'original à signer."""
        pdf, original, both = cls.Format.PDF, cls.Format.ORIGINAL, cls.Format.BOTH
        return Q(request__status=Request.Status.APPROVED) & (
            Q(format__in=[pdf, both], file="") | Q(format__in=[original, both], original_ready_at__isnull=True))

    @classmethod
    def pickup_filter(cls):
        """L'original est prêt au bureau RH et le collaborateur ne l'a pas encore récupéré."""
        return Q(request__status=Request.Status.APPROVED, original_ready_at__isnull=False, collected_at__isnull=True,
                 format__in=[cls.Format.ORIGINAL, cls.Format.BOTH])

    @property
    def late(self):
        """Pas encore livré, et le délai promis est passé (les RH le voient en rouge)."""
        return (self.state in ("IN_PROGRESS", "TO_PREPARE") and self.due_date is not None
                and self.due_date < timezone.localdate())
