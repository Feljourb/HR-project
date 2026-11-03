"""Le module Notes de frais.

Step 1 : les deux listes de référence du module, gérées par Admin RH :
- ExpenseCategory : les catégories de dépense (transport, indemnité journalière, hôtel...) ;
- ExpenseScale : le BARÈME interne, par grade (A -> E) : les plafonds indemnité / transport / hôtel.
Une dépense est plafonnée selon le grade du collaborateur ET la catégorie (ex. une nuit d'hôtel d'un
Grade C : au plus 700 MAD).

Step 2-3 : ExpenseClaim (la note de frais, attachée à une demande du moteur) et ExpenseLine (une dépense
et son justificatif).
"""
import uuid
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from employees.models import Employee, Grade, ReferenceItem
from workflows.models import Request

POSITIVE = [MinValueValidator(Decimal("0.01"))]
MAX_RECEIPT_SIZE = 5 * 1024 * 1024  # 5 Mo : une photo de téléphone ou un PDF scanné
# Le maximum d'UNE dépense, même sans plafond du barème (carburant, billet d'avion...) : une sécurité
# contre une faute de frappe (un zéro de trop). Valeur standard, à confirmer par les RH.
MAX_LINE_AMOUNT = Decimal("100000")
TOO_HIGH = "Montant trop élevé : au plus 100 000 MAD par dépense (vérifiez la saisie ; au-delà, voyez avec les RH)."


class ExpenseCategory(ReferenceItem):
    """Une catégorie de dépense. Comme les autres listes : jamais supprimée, seulement désactivée."""

    class Ceiling(models.TextChoices):
        # Quel plafond du barème s'applique à UNE dépense de cette catégorie (standard, à confirmer par les RH) :
        NONE = "NONE", "Aucun plafond"
        DAILY_ALLOWANCE = "DAILY_ALLOWANCE", "Indemnité (par jour)"
        TRANSPORT = "TRANSPORT", "Transport (par trajet)"
        HOTEL = "HOTEL", "Hôtel (par nuit)"

    ceiling = models.CharField("Plafond du barème", max_length=20, choices=Ceiling.choices, default=Ceiling.NONE)
    # Un justificatif (photo du ticket, facture PDF) obligatoire pour chaque dépense de cette catégorie.
    receipt_required = models.BooleanField("Justificatif obligatoire", default=True)

    class Meta(ReferenceItem.Meta):
        verbose_name = "Catégorie de dépense"
        verbose_name_plural = "Catégories de dépense"


class ExpenseScale(models.Model):
    """Le barème d'UN grade : les montants maximum remboursés (MAD). Une ligne par grade.
    Pas dans l'app employees : le grade appartient à la fiche, mais ces montants appartiennent aux notes de frais."""

    # CASCADE est impossible à atteindre (un grade n'est jamais supprimé) ; PROTECT par sécurité.
    grade = models.OneToOneField(Grade, on_delete=models.PROTECT, related_name="expense_scale", verbose_name="Grade")
    daily_allowance = models.DecimalField("Indemnité par jour (MAD)", max_digits=10, decimal_places=2, validators=POSITIVE)
    transport = models.DecimalField("Transport par trajet (MAD)", max_digits=10, decimal_places=2, validators=POSITIVE)
    hotel = models.DecimalField("Hôtel par nuit (MAD)", max_digits=10, decimal_places=2, validators=POSITIVE)

    class Meta:
        ordering = ["grade__name"]
        verbose_name = "Barème (par grade)"
        verbose_name_plural = "Barème (par grade)"

    def __str__(self):
        return f"Barème {self.grade}"

    def ceiling_for(self, category):
        """Le plafond d'une dépense de cette catégorie pour ce grade, ou None (pas de plafond)."""
        return {
            ExpenseCategory.Ceiling.DAILY_ALLOWANCE: self.daily_allowance,
            ExpenseCategory.Ceiling.TRANSPORT: self.transport,
            ExpenseCategory.Ceiling.HOTEL: self.hotel,
        }.get(category.ceiling)


# --- La note de frais (step 2) ------------------------------------------------------------

class ExpenseClaim(models.Model):
    """Une note de frais (ex. "Mission Agadir") : plusieurs dépenses (lignes), un total, un circuit.
    Comme un congé : le statut n'est PAS ici, on le lit dans request.status (le moteur)."""

    # CASCADE : sans sa demande, la note n'a pas de sens (et une demande n'est jamais supprimée).
    request = models.OneToOneField(Request, on_delete=models.CASCADE, related_name="expense", verbose_name="Demande")
    # Le même que request.requester : les règles (plafond du grade) se vérifient AVANT que la demande existe.
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="expense_claims", verbose_name="Collaborateur")
    title = models.CharField("Objet", max_length=150)
    # Le total, calculé UNE fois à l'envoi (les lignes ne changent plus ensuite) : pour les listes et les sommes.
    total = models.DecimalField("Total (MAD)", max_digits=12, decimal_places=2)
    # Le remboursement (step 5) : le RH le note quand il a payé.
    reimbursed_at = models.DateField("Remboursée le", null=True, blank=True)
    reimbursed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name="+", verbose_name="Remboursée par")

    class Meta:
        ordering = ["-id"]
        verbose_name = "Note de frais"
        verbose_name_plural = "Notes de frais"

    def __str__(self):
        return f"{self.title} ({self.employee})"


def receipt_path(line, filename):
    """Où ranger un justificatif : receipts/2026/11/<nom au hasard>.pdf. Un nom au hasard (uuid) :
    on ne devine pas l'adresse d'un fichier, et deux "ticket.jpg" ne s'écrasent pas."""
    today = timezone.localdate()
    return f"receipts/{today:%Y/%m}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


def receipt_size(file):
    if file.size > MAX_RECEIPT_SIZE:
        raise ValidationError("Le justificatif dépasse 5 Mo (prenez une photo moins lourde).")


class ExpenseLine(models.Model):
    """Une dépense : un jour d'indemnité, un trajet, une nuit d'hôtel... avec son justificatif."""

    claim = models.ForeignKey(ExpenseClaim, on_delete=models.CASCADE, related_name="lines", verbose_name="Note de frais")
    date = models.DateField("Date")
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="lines", verbose_name="Catégorie")
    amount = models.DecimalField("Montant (MAD)", max_digits=10, decimal_places=2, validators=POSITIVE)
    description = models.CharField("Détail", max_length=200, blank=True)
    receipt = models.FileField(
        "Justificatif", upload_to=receipt_path, blank=True,
        validators=[FileExtensionValidator(["pdf", "jpg", "jpeg", "png"]), receipt_size],
    )
    receipt_name = models.CharField("Nom du fichier envoyé", max_length=200, blank=True)  # pour l'afficher

    class Meta:
        ordering = ["date", "id"]
        verbose_name = "Dépense"

    def __str__(self):
        return f"{self.date:%d/%m/%Y} - {self.category} - {self.amount} MAD"

    def clean(self):
        if self.date is None or self.category_id is None or self.amount is None:
            return  # le champ vide a déjà son message ("Ce champ est obligatoire")
        # Règle 0 : un montant raisonnable, même pour une catégorie sans plafond.
        if self.amount > MAX_LINE_AMOUNT:
            raise ValidationError({"amount": TOO_HIGH})
        # Règle 1 : pas de dépense dans le futur (on rembourse ce qui a été payé).
        if self.date > timezone.localdate():
            raise ValidationError({"date": "La date ne peut pas être dans le futur."})
        # Règle 2 : une catégorie désactivée par Admin RH ne se choisit plus.
        if not self.category.is_active:
            raise ValidationError({"category": "Cette catégorie n'est plus proposée."})
        # Règle 3 : le justificatif, si la catégorie le demande.
        if self.category.receipt_required and not self.receipt:
            raise ValidationError({"receipt": f"Justificatif obligatoire pour « {self.category} »."})
        # Règle 4 : le plafond du barème, selon le grade du collaborateur (ex. Grade E, hôtel : 400 MAD par nuit).
        if self.category.ceiling != ExpenseCategory.Ceiling.NONE:
            grade = self.claim.employee.grade
            if grade is None:
                raise ValidationError("Votre fiche n'a pas de grade : demandez aux RH de le compléter.")
            scale = ExpenseScale.objects.filter(grade=grade).first()
            ceiling = scale.ceiling_for(self.category) if scale else None
            if ceiling is not None and self.amount > ceiling:
                raise ValidationError({"amount": (
                    f"Plafond {self.category.get_ceiling_display().lower()} pour votre grade : {ceiling:.2f} MAD "
                    f"(cette dépense : {self.amount:.2f} MAD)."
                )})
