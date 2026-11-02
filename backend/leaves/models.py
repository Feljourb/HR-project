"""Le module Congés.

Step 1 : les deux listes de référence du module, gérées par Admin RH :
- LeaveType : les types de congé (annuel, mariage, maladie...) et leurs règles ;
- PublicHoliday : les jours fériés (ils ne comptent pas dans un congé, voir step 2).
"""
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from employees.models import ReferenceItem


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
