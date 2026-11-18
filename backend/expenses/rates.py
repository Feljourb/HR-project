"""Les taux de change, mis à jour TOUT SEULS chaque matin (2026-11-16 : Admin RH ne doit pas y penser).

Source : open.er-api.com (gratuite, sans compte, un taux par jour). Une autre source (ex. Bank Al-Maghrib, l'officielle,
quand l'IT donne une clé) = changer seulement RATES_URL dans .env. Sans internet ou en panne : rien ne casse,
l'application garde le dernier taux connu (la date "mis à jour le" le montre dans la page Reference lists).
"""
import json
import logging
import urllib.request
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from employees.notifications import on_morning_round

from .models import Currency

logger = logging.getLogger(__name__)
# Les taux "1 MAD = ... devise" (ex. {"EUR": 0.09128}) ; on garde l'inverse : 1 EUR = 10,9553 MAD.
DEFAULT_URL = "https://open.er-api.com/v6/latest/MAD"


def fetch_rates():
    """Les taux du jour : {"EUR": Decimal("0.09128"), ...} (combien de devise pour 1 MAD)."""
    url = getattr(settings, "RATES_URL", "") or DEFAULT_URL
    with urllib.request.urlopen(url, timeout=10) as response:  # 10 s au plus : le tour du matin n'attend pas
        data = json.load(response)
    if data.get("result") != "success":
        raise ValueError(f"Réponse inattendue : {data.get('result')}")
    return {code: Decimal(str(value)) for code, value in data["rates"].items()}


@receiver(post_save, sender=Currency)
def new_currency_rate(sender, instance, created, **kwargs):
    """Une devise AJOUTÉE par Admin RH (2026-11-18, ex. GBP) : son taux est cherché tout de suite (sinon elle vaudrait
    1 MAD jusqu'au lendemain matin). Sans internet : rien ne casse, le tour du matin réessaiera."""
    if created and instance.automatic and instance.name.upper() != "MAD" and not getattr(settings, "TESTING", False):
        try:
            update_rates()
        except Exception as error:  # noqa: BLE001 (pas d'internet, site en panne)
            logger.warning("Taux de %s pas trouvé tout de suite : %s", instance.name, error)


@on_morning_round
def morning_rates():
    """Le travail du matin (le facteur, vers 8 h). Jamais pendant les tests (pas d'internet dans un test)."""
    if not getattr(settings, "TESTING", False):
        update_rates()


def update_rates(rates=None):
    """Chaque matin (et `make rates`) : le nouveau taux de chaque devise active "automatique" (pas le MAD, pas
    celles qu'Admin RH corrige à la main). Rend la liste des devises mises à jour."""
    rates = rates if rates is not None else fetch_rates()
    updated = []
    for currency in Currency.objects.filter(is_active=True, automatic=True).exclude(name__iexact="MAD"):
        per_mad = rates.get(currency.name.upper())
        if not per_mad:
            logger.warning("Pas de taux pour %s", currency.name)
            continue
        currency.rate_to_mad = (Decimal(1) / per_mad).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        currency.rate_updated_at = timezone.now()
        currency.save(update_fields=["rate_to_mad", "rate_updated_at"])
        updated.append(currency.name)
    return updated
