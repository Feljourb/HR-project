"""Step 2 : combien de jours compte un congé (la "caisse" : chaque jour a son prix, on additionne).

    count_days(date(2026, 11, 6), date(2026, 11, 9))  ->  Decimal("1.5")
    (vendredi 6 = Marche Verte : 0 ; samedi : 0,5 ; dimanche : 0 ; lundi : 1)

Une seule règle, utilisée partout : le formulaire (aperçu), la validation et le solde.
"""
import datetime
from decimal import Decimal

from .models import PublicHoliday

# Le prix de chaque jour de la semaine (weekday() : lundi = 0 ... dimanche = 6).
# Samedi : personne ne travaille, mais un congé le compte pour une demi-journée (décision RH, 2026-11-02).
DAY_VALUES = {0: Decimal("1"), 1: Decimal("1"), 2: Decimal("1"), 3: Decimal("1"), 4: Decimal("1"),
              5: Decimal("0.5"), 6: Decimal("0")}
HALF = Decimal("0.5")


def holiday_dates(start, end):
    """Les jours fériés ACTIFS entre deux dates (un jour férié désactivé est un jour normal)."""
    return set(PublicHoliday.objects.filter(date__range=(start, end), is_active=True).values_list("date", flat=True))


def day_values(start, end, starts_afternoon=False, ends_noon=False):
    """Le détail, jour par jour : [(date, prix), ...]. Sert au total, et à l'écran pour expliquer le total.

    starts_afternoon : le congé commence l'après-midi (le premier jour compte une demi-journée) ;
    ends_noon        : il finit à midi (le dernier jour compte une demi-journée).
    Une demi-journée ne change qu'un jour de semaine : samedi, dimanche et fériés gardent leur prix."""
    if end < start:
        raise ValueError("La date de fin est avant la date de début.")
    holidays = holiday_dates(start, end)  # une seule requête SQL pour toute la période

    values = []
    day = start
    while day <= end:
        value = Decimal("0") if day in holidays else DAY_VALUES[day.weekday()]
        if value == 1:  # un vrai jour de travail : la demi-journée enlève 0,5
            if day == start and starts_afternoon:
                value -= HALF
            if day == end and ends_noon:
                value -= HALF
        values.append((day, value))
        day += datetime.timedelta(days=1)
    return values


def count_days(start, end, starts_afternoon=False, ends_noon=False):
    """Le nombre de jours du congé (ex. Decimal("2.5"))."""
    return sum((value for _, value in day_values(start, end, starts_afternoon, ends_noon)), Decimal("0"))
