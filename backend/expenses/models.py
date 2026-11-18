"""Le module Notes de frais.

Step 1 : les deux listes de référence du module, gérées par Admin RH :
- ExpenseCategory : les catégories de dépense (transport, indemnité journalière, hôtel...) ;
- ExpenseScale : le BARÈME interne, par grade (A -> E) : les plafonds indemnité / transport / hôtel.
Une dépense est plafonnée selon le grade du collaborateur ET la catégorie (ex. une nuit d'hôtel d'un
Grade C : au plus 700 MAD).

Step 2-3 : ExpenseClaim (la note de frais, attachée à une demande du moteur) et ExpenseLine (une dépense
et son justificatif).

Remarques de la réunion (2026-11-16) : dépasser le plafond avec une justification (par catégorie), et un valideur
qui DIMINUE un montant (ExpenseCorrection), selon le réglage d'Admin RH (ExpenseSettings).
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
# Plusieurs justificatifs par dépense (2026-11-11), ex. la facture de l'hôtel + le ticket de la carte bancaire.
MAX_RECEIPTS = 5
# Le maximum d'UNE dépense, même sans plafond du barème (carburant, billet d'avion...) : une sécurité
# contre une faute de frappe (un zéro de trop). Valeur standard, à confirmer par les RH.
MAX_LINE_AMOUNT = Decimal("100000")
TOO_HIGH = "Montant trop élevé : au plus 100 000 MAD par dépense (vérifiez la saisie ; au-delà, voyez avec les RH)."


class ExpenseCategory(ReferenceItem):
    """Une catégorie de dépense. Comme les autres listes : jamais supprimée, seulement désactivée.
    Son PLAFOND, par grade (2026-11-18, standard SAP Concur : une limite par type de dépense et par groupe) :
    CategoryCeiling ; aucun plafond pour un grade = montant libre (seule la sécurité de 100 000 MAD)."""

    class Per(models.TextChoices):
        # Une ligne de la note = UNE de ces unités ; le plafond s'applique à chaque ligne.
        EXPENSE = "EXPENSE", "par dépense"
        DAY = "DAY", "par jour"
        TRIP = "TRIP", "par trajet"
        NIGHT = "NIGHT", "par nuit"

    per = models.CharField("Le plafond s'applique", max_length=10, choices=Per.choices, default=Per.EXPENSE)
    # Un justificatif (photo du ticket, facture PDF) obligatoire pour chaque dépense de cette catégorie.
    # Décoché par défaut (remarque des RH, 2026-11-16 : pas obligatoire, comme leur outil) ; Admin RH peut le cocher.
    receipt_required = models.BooleanField("Justificatif obligatoire", default=False)
    # Remarque de la réunion (2026-11-16), standard SAP Concur ("soft limit") : Admin RH choisit, par catégorie,
    # si une dépense peut dépasser le plafond du barème. Oui -> permis AVEC une justification, et les valideurs
    # le voient (puce orange) ; non (par défaut) -> refusé, comme avant.
    above_ceiling_allowed = models.BooleanField("Dépassement du plafond autorisé (avec justification)", default=False)

    class Meta(ReferenceItem.Meta):
        verbose_name = "Catégorie de dépense"
        verbose_name_plural = "Catégories de dépense"


class Currency(ReferenceItem):
    """Une devise (remarque des RH, 2026-11-16, comme leur outil NOOR) : le collaborateur tape le montant DU REÇU
    (ex. 20 EUR) ; l'application le convertit en MAD (le remboursement, le plafond et le total sont en MAD).
    `name` = le code ("EUR"). Le taux = combien de MAD pour 1 unité (1 EUR = 10,96 MAD) : écrit dans ce sens pour
    éviter l'erreur de leur outil (USD 1,1315 donnait 20 USD = 17 MAD).
    Mis à jour TOUT SEUL chaque matin (expenses/rates.py, le tour du matin du facteur) ; Admin RH peut le corriger
    à la main en décochant "automatique" (alors l'application n'y touche plus)."""

    rate_to_mad = models.DecimalField("1 unité = ... MAD", max_digits=12, decimal_places=4, default=Decimal("1"),
                                      validators=[MinValueValidator(Decimal("0.0001"))])
    automatic = models.BooleanField("Taux mis à jour automatiquement", default=True)
    rate_updated_at = models.DateTimeField("Taux mis à jour le", null=True, blank=True)

    class Meta(ReferenceItem.Meta):
        verbose_name = "Devise"
        verbose_name_plural = "Devises"

    def clean(self):
        super().clean()
        if (self.name or "").strip().upper() == "MAD" and self.rate_to_mad != 1:
            raise ValidationError({"rate_to_mad": "Le dirham (MAD) vaut toujours 1."})


class CategoryCeiling(models.Model):
    """Le plafond d'UNE catégorie pour UN grade (2026-11-18), ex. Hébergement + Grade E = 400 MAD par nuit.
    Pas de ligne = pas de plafond pour ce grade. Admin RH les remplit dans "Réglages des notes de frais" (un tableau :
    une ligne par catégorie, une colonne par grade)."""

    category = models.ForeignKey(ExpenseCategory, on_delete=models.CASCADE, related_name="ceilings", verbose_name="Catégorie")
    grade = models.ForeignKey(Grade, on_delete=models.CASCADE, related_name="expense_ceilings", verbose_name="Grade")
    amount = models.DecimalField("Plafond (MAD)", max_digits=10, decimal_places=2, validators=POSITIVE)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["category", "grade"], name="expenses_one_ceiling_per_grade")]
        verbose_name = "Plafond (catégorie, grade)"
        verbose_name_plural = "Plafonds (catégorie, grade)"

    def __str__(self):
        return f"{self.category} · {self.grade} : {self.amount} MAD"


class ExpenseScale(models.Model):
    """ANCIEN barème (jusqu'au 18/11/2026) : 3 colonnes fixes (indemnité / transport / hôtel) par grade. Ses montants
    ont été recopiés dans CategoryCeiling (migration 0013) ; gardé pour l'historique, plus utilisé par les règles."""

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
    """Une dépense : un jour d'indemnité, un trajet, une nuit d'hôtel... avec ses justificatifs (ExpenseReceipt)."""

    claim = models.ForeignKey(ExpenseClaim, on_delete=models.CASCADE, related_name="lines", verbose_name="Note de frais")
    date = models.DateField("Date")
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="lines", verbose_name="Catégorie")
    amount = models.DecimalField("Montant (MAD)", max_digits=10, decimal_places=2, validators=POSITIVE)
    # Une dépense payée dans une autre devise (2026-11-16) : le montant DU REÇU (ex. 20 EUR) et le taux du jour
    # de l'envoi (une photo, comme le plafond) ; `amount` = la conversion en MAD (20 × 10,96 = 219,20).
    # Vide = payée en MAD (le cas normal, et toutes les anciennes lignes).
    currency = models.ForeignKey(Currency, on_delete=models.PROTECT, null=True, blank=True, related_name="+", verbose_name="Devise")
    original_amount = models.DecimalField("Montant du reçu", max_digits=12, decimal_places=2, null=True, blank=True)
    rate = models.DecimalField("Taux appliqué (1 unité = ... MAD)", max_digits=12, decimal_places=4, null=True, blank=True)
    description = models.CharField("Détail", max_length=200, blank=True)
    # Le plafond du grade AU MOMENT de l'envoi (une photo, comme le total) : si Admin RH change le barème plus
    # tard, la note garde le plafond qui lui a été appliqué. Vide = pas de plafond.
    ceiling = models.DecimalField("Plafond appliqué (MAD)", max_digits=10, decimal_places=2, null=True, blank=True)
    # Pourquoi cette dépense dépasse le plafond (obligatoire dans ce cas, sinon vide).
    justification = models.CharField("Justification du dépassement", max_length=300, blank=True)

    class Meta:
        ordering = ["date", "id"]
        verbose_name = "Dépense"

    def __str__(self):
        return f"{self.date:%d/%m/%Y} - {self.category} - {self.amount} MAD"

    @property
    def above_ceiling(self):
        """De combien la dépense dépasse son plafond (ex. 200), ou None (pas de plafond, ou en dessous)."""
        if self.ceiling is None or self.amount is None or self.amount <= self.ceiling:
            return None
        return self.amount - self.ceiling

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
        # (Règle 3, les justificatifs : check_receipts, car ils sont enregistrés APRÈS la ligne.)
        # Règle 4 : le plafond de la catégorie pour le grade du collaborateur (2026-11-18 : un plafond par catégorie et
        # par grade, ex. Hébergement + Grade E = 400 MAD par nuit). Une catégorie plafonnée et pas de grade : refusé.
        self.ceiling = None
        self.maximum = None  # (pas enregistré) le plafond du grade, pour la vérification par jour / nuit / mission
        limits = CategoryCeiling.objects.filter(category=self.category)
        if limits.exists():
            grade = self.claim.employee.grade
            if grade is None:
                raise ValidationError("Votre fiche n'a pas de grade : demandez aux RH de le compléter.")
            row = limits.filter(grade=grade).first()
            self.maximum = row.amount if row else None  # pas de plafond pour CE grade : libre
        self.justification = (self.justification or "").strip()
        # 2026-11-18 (l'utilisatrice, standard SAP Concur) : "par jour" = le TOTAL de la catégorie ce jour-là, "par nuit" =
        # cette nuit-là, "par trajet" = toute la mission (la note) : vérifié avec les autres lignes de la note
        # (services.check_maximums). "Par dépense" : chaque ligne seule, ici.
        if self.category.per != ExpenseCategory.Per.EXPENSE:
            return
        self.ceiling = self.maximum
        self.check_above(f"Maximum {self.category} ({self.category.get_per_display()}) pour votre grade : "
                         f"{self.maximum or 0:.2f} MAD (cette dépense : {self.amount:.2f} MAD)")

    def check_above(self, limit):
        """La ligne dépasse ce qui lui restait (self.ceiling) : refusée, sauf si Admin RH permet le dépassement AVEC une
        raison (le N+1 et les RH la lisent). Pas de dépassement : rien à justifier."""
        if self.above_ceiling is None:
            self.justification = ""
            return
        if not self.category.above_ceiling_allowed:
            raise ValidationError({"amount": f"{limit}."})
        if not self.justification:
            raise ValidationError({"justification": f"{limit} : expliquez pourquoi elle le dépasse."})

    def check_receipts(self, files):
        """Règle 3 : les justificatifs envoyés pour cette dépense (files = les fichiers, pas encore enregistrés).
        Obligatoire si la catégorie le demande ; au plus MAX_RECEIPTS ; chacun pdf / jpg / png de 5 Mo au plus."""
        if self.category_id and self.category.receipt_required and not files:
            raise ValidationError(f"Justificatif obligatoire pour « {self.category} ».")
        if len(files) > MAX_RECEIPTS:
            raise ValidationError(f"Au plus {MAX_RECEIPTS} justificatifs par dépense.")
        messages = []
        for file in files:
            try:
                ExpenseReceipt(file=file, name=file.name[:200]).full_clean(exclude=["line"])
            except ValidationError as problem:
                messages += [f"{file.name} : {message}" for message in problem.messages]
        if messages:
            raise ValidationError(messages)


class ExpenseSettings(models.Model):
    """Les réglages des notes de frais (2026-11-16, remarque de la réunion) : UNE ligne, changée par Admin RH dans la
    page Reference lists -> Expenses -> "Réglages des notes de frais" (pas dans le code)."""

    class Correctors(models.TextChoices):
        # Qui peut DIMINUER le montant d'une dépense pendant la validation (standard SAP Concur : "approver adjust").
        MANAGER_AND_HR = "MANAGER_AND_HR", "Le N+1 et les RH"
        HR_ONLY = "HR_ONLY", "Seulement les RH"
        NOBODY = "NOBODY", "Personne (valider ou refuser seulement)"

    who_can_correct = models.CharField("Qui peut corriger un montant", max_length=20, choices=Correctors.choices,
                                       default=Correctors.MANAGER_AND_HR)
    # La trace : qui a changé le réglage en dernier, et quand.
    updated_at = models.DateTimeField("Modifié le", auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+", verbose_name="Modifié par")

    class Meta:
        verbose_name = "Réglages des notes de frais"
        verbose_name_plural = "Réglages des notes de frais"

    def __str__(self):
        return "Réglages des notes de frais"

    def save(self, *args, **kwargs):
        self.pk = 1  # toujours la même ligne
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        current, _ = cls.objects.get_or_create(pk=1)
        return current


class ExpenseCorrection(models.Model):
    """Un valideur (N+1 ou RH) a DIMINUÉ le montant d'une dépense (ex. 200 -> 150 : le ticket dit 150).
    La trace (standard) : l'ancien et le nouveau montant, le motif, qui et quand ; jamais modifiée ni supprimée.
    La ligne garde le montant actuel (ExpenseLine.amount) : le total, le PDF et le remboursement l'utilisent."""

    line = models.ForeignKey(ExpenseLine, on_delete=models.CASCADE, related_name="corrections", verbose_name="Dépense")
    old_amount = models.DecimalField("Ancien montant (MAD)", max_digits=10, decimal_places=2)
    new_amount = models.DecimalField("Nouveau montant (MAD)", max_digits=10, decimal_places=2)
    reason = models.CharField("Motif", max_length=300)
    corrected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                     related_name="+", verbose_name="Corrigé par")
    # "N+1" ou "RH" : à quel titre (l'étape du circuit à laquelle il répondait).
    as_role = models.CharField("En tant que", max_length=40)
    corrected_at = models.DateTimeField("Le", auto_now_add=True)

    class Meta:
        ordering = ["corrected_at", "id"]
        verbose_name = "Correction d'un montant"
        verbose_name_plural = "Corrections des montants"

    def __str__(self):
        return f"{self.old_amount} -> {self.new_amount} MAD ({self.reason})"


class ExpenseReceipt(models.Model):
    """Un justificatif d'une dépense (2026-11-11 : PLUSIEURS par dépense, ex. la facture + le ticket de carte).
    Jamais servi par une adresse publique : seulement /api/expenses/receipts/<id>/, pour ceux que la note concerne."""

    line = models.ForeignKey(ExpenseLine, on_delete=models.CASCADE, related_name="receipts", verbose_name="Dépense")
    file = models.FileField(
        "Fichier", upload_to=receipt_path,
        validators=[FileExtensionValidator(["pdf", "jpg", "jpeg", "png"]), receipt_size],
    )
    name = models.CharField("Nom du fichier envoyé", max_length=200, blank=True)  # pour l'afficher

    class Meta:
        ordering = ["id"]
        verbose_name = "Justificatif"

    def __str__(self):
        return self.name or self.file.name
