"""Le module Congés.

Step 1 : les deux listes de référence du module, gérées par Admin RH :
- LeaveType : les types de congé (annuel, mariage, maladie...) et leurs règles ;
- PublicHoliday : les jours fériés (ils ne comptent pas dans un congé, voir step 2).
Step 3 : LeaveRequest, une demande de congé (les dates) attachée à une demande du moteur (le circuit).
Step 4 : LeaveSettings, les règles du solde (ancienneté, maximum par an...).
"""
import datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models

from employees.models import Employee, ReferenceItem
from workflows.models import Request


class LeaveType(ReferenceItem):
    """Un type de congé. Comme les autres listes : jamais supprimé, seulement désactivé."""

    # Congé annuel : oui (il "consomme" le solde). Mariage, maladie, sans solde... : non.
    deducts_balance = models.BooleanField("Décompté du solde", default=False)
    # Le maximum légal d'un congé exceptionnel (ex. mariage du salarié : 4 jours, Code du travail).
    # Vide = pas de maximum (congé annuel : c'est le solde qui limite ; maladie : le certificat).
    max_days = models.DecimalField(
        "Durée maximale (jours)", max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0.5"))],
    )

    class Meta(ReferenceItem.Meta):
        verbose_name = "Type de congé"
        verbose_name_plural = "Types de congé"


class PublicHoliday(ReferenceItem):
    """Un jour férié : il ne compte pas dans un congé (ex. un congé du 4 au 8 novembre fait 4 jours, pas 5,
    à cause de la Marche Verte le 6). Les fêtes religieuses changent de date chaque année (calendrier lunaire) :
    Admin RH les ajoute quand la date officielle est annoncée."""

    date = models.DateField("Date")

    # Pas le Meta de ReferenceItem : son nom n'est PAS unique ("Aïd Al Fitr" revient chaque année),
    # c'est la DATE qui est unique (un seul jour férié par jour).
    class Meta:
        verbose_name = "Jour férié"
        verbose_name_plural = "Jours fériés"
        ordering = ["date"]
        constraints = [
            models.UniqueConstraint(
                fields=["date"], name="leaves_publicholiday_unique_date",
                violation_error_message="Il y a déjà un jour férié à cette date.",
            ),
        ]

    def __str__(self):
        return f"{self.date:%d/%m/%Y} - {self.name}"


class LeaveSettings(models.Model):
    """Step 4 : les règles du solde que les RH peuvent encore corriger. Une seule ligne, changée dans /admin
    (sans toucher au code), comme les réglages de sécurité."""

    # Le solde de chacun part de 0 à cette date (ou à son embauche, si elle est après) :
    # le jour où l'application commence à compter les congés.
    counting_start = models.DateField("Début du calcul des soldes", default=datetime.date(2026, 11, 1))
    # Ancienneté (standard, Code du travail art. 231) : + 1,5 jour par an pour chaque période complète de 5 ans.
    seniority_years = models.PositiveSmallIntegerField("Ancienneté : tous les (ans)", default=5)
    seniority_bonus = models.DecimalField("Ancienneté : jours en plus par an", max_digits=4, decimal_places=2,
                                          default=Decimal("1.5"), validators=[MinValueValidator(Decimal("0"))])
    # Le maximum par an, ancienneté comprise (règle de l'entreprise : 36 ; la loi dit 30).
    max_days_per_year = models.DecimalField("Maximum par an (jours)", max_digits=5, decimal_places=2,
                                            default=Decimal("36"), validators=[MinValueValidator(Decimal("0"))])

    class Meta:
        verbose_name = "Réglages des congés"
        verbose_name_plural = "Réglages des congés"

    def __str__(self):
        return "Réglages des congés"

    def save(self, *args, **kwargs):
        self.pk = 1  # toujours la même ligne
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        settings, _ = cls.objects.get_or_create(pk=1)
        return settings


class LeaveRequest(models.Model):
    """Une demande de congé. Deux tables qui travaillent ensemble :
    - ici, ce que seul le module Congés connaît : le type, les dates, le nombre de jours ;
    - `request` (le moteur) : le circuit, qui valide, le statut (en cours, acceptée...) et l'historique.
    Le statut n'est donc PAS ici : on le lit dans request.status (une seule vérité)."""

    # Les demandes qui "occupent" des jours : en cours ou acceptées (refusée / annulée = jours libres).
    ACTIVE = [Request.Status.IN_PROGRESS, Request.Status.APPROVED]

    # CASCADE : sans sa demande, le congé n'a pas de sens (et une demande n'est jamais supprimée).
    request = models.OneToOneField(Request, on_delete=models.CASCADE, related_name="leave", verbose_name="Demande")
    # Le même que request.requester, mais ici aussi : les règles (chevauchement, solde) se vérifient
    # AVANT que la demande du moteur existe, et "mes congés" se lit sans passer par le moteur.
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="leaves", verbose_name="Collaborateur")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="leaves", verbose_name="Type")
    start_date = models.DateField("Du")
    end_date = models.DateField("Au")
    starts_afternoon = models.BooleanField("Commence l'après-midi", default=False)
    ends_noon = models.BooleanField("Finit à midi", default=False)
    # Le nombre de jours, calculé UNE fois à l'envoi (la "photo", comme le circuit) :
    # si Admin RH ajoute un jour férié plus tard, un congé déjà envoyé ne change pas tout seul.
    days = models.DecimalField("Jours", max_digits=5, decimal_places=1)
    reason = models.TextField("Motif", blank=True)

    class Meta:
        ordering = ["-start_date"]
        verbose_name = "Demande de congé"
        verbose_name_plural = "Demandes de congé"

    def __str__(self):
        return f"{self.leave_type} du {self.start_date:%d/%m/%Y} au {self.end_date:%d/%m/%Y} ({self.employee})"

    def overlapping(self):
        """Les autres congés (en cours ou acceptés) de ce collaborateur qui touchent les mêmes jours."""
        others = (
            LeaveRequest.objects.filter(employee=self.employee_id, request__status__in=self.ACTIVE,
                                        start_date__lte=self.end_date, end_date__gte=self.start_date)
            .exclude(pk=self.pk)
        )
        # Deux demi-journées du même jour ne se chevauchent pas : l'un finit à midi, l'autre commence l'après-midi.
        if self.starts_afternoon:
            others = others.exclude(end_date=self.start_date, ends_noon=True)
        if self.ends_noon:
            others = others.exclude(start_date=self.end_date, starts_afternoon=True)
        return others

    def clean(self):
        # Importés ici : counting et balance importent ce fichier (sinon import en boucle).
        from .balance import balance
        from .counting import count_days, days_label

        if self.start_date is None or self.end_date is None or self.leave_type_id is None:
            return  # le champ vide a déjà son message ("Ce champ est obligatoire")
        # Règle 1 : les dates dans le bon ordre.
        if self.end_date < self.start_date:
            raise ValidationError({"end_date": "La date de fin est avant la date de début."})
        # Règle 2 : un type désactivé par Admin RH ne se demande plus.
        if not self.leave_type.is_active:
            raise ValidationError({"leave_type": "Ce type de congé n'est plus proposé."})
        # Règle 3 : au moins une demi-journée (ex. un dimanche seul, ou un jour férié seul : 0 jour).
        self.days = count_days(self.start_date, self.end_date, self.starts_afternoon, self.ends_noon)
        if self.days <= 0:
            raise ValidationError("Ces dates ne comptent aucun jour de congé (week-end ou jour férié).")
        # Règle 4 : le maximum légal du type (ex. mariage du salarié : 4 jours).
        maximum = self.leave_type.max_days
        if maximum is not None and self.days > maximum:
            raise ValidationError(
                f"« {self.leave_type} » : {days_label(maximum)} jour(s) au maximum, "
                f"cette demande en compte {days_label(self.days)}."
            )
        # Règle 5 : pas deux congés sur les mêmes jours.
        other = self.overlapping().first() if self.employee_id else None
        if other is not None:
            raise ValidationError(
                f"Vous avez déjà un congé sur ces dates (du {other.start_date:%d/%m/%Y} au {other.end_date:%d/%m/%Y})."
            )
        # Règle 6 : le solde suffit (seulement les types "décomptés du solde", ex. congé annuel). Jamais de solde négatif.
        if self.leave_type.deducts_balance and self.employee_id:
            available = balance(self.employee, exclude=self.pk)["available"]
            if self.days > available:
                raise ValidationError(
                    f"Solde insuffisant : {days_label(max(available, 0))} jour(s) disponible(s), "
                    f"cette demande en compte {days_label(self.days)}."
                )
