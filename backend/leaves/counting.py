"""Step 2 : combien de jours compte un congé (la "caisse" : chaque jour a son prix, on additionne).

    count_days(date(2026, 11, 6), date(2026, 11, 9))  ->  Decimal("1.5")
    (vendredi 6 = Marche Verte : 0 ; samedi : 0,5 ; dimanche : 0 ; lundi : 1)

Une seule règle, utilisée partout : le formulaire (aperçu), la validation et le solde.
"""
import datetime
from decimal import Decimal

from .models import PublicHoliday

# Chaque jour = (matin, après-midi), selon le jour de la semaine (weekday() : lundi = 0 ... dimanche = 6).
# Samedi : seul le MATIN compte (0,5), l'après-midi vaut 0 (décision RH, 2026-11-02).
ZERO, HALF = Decimal("0"), Decimal("0.5")
HALVES = {0: (HALF, HALF), 1: (HALF, HALF), 2: (HALF, HALF), 3: (HALF, HALF), 4: (HALF, HALF),
          5: (HALF, ZERO), 6: (ZERO, ZERO)}


def holiday_dates(start, end):
    """Les jours fériés ACTIFS entre deux dates (un jour férié désactivé est un jour normal).
    Les années concernées ont d'abord leurs jours fériés créés (voir holidays.py)."""
    from .holidays import ensure_years  # ici : holidays importe les modèles, comme ce fichier
    ensure_years(start, end)
    return set(PublicHoliday.objects.filter(date__range=(start, end), is_active=True).values_list("date", flat=True))


def day_values(start, end, starts_afternoon=False, ends_noon=False):
    """Le détail, jour par jour : [(date, prix), ...]. Sert au total, et à l'écran pour expliquer le total.

    starts_afternoon : le congé commence l'après-midi (le MATIN du premier jour n'est pas pris) ;
    ends_noon        : il finit à midi (l'APRÈS-MIDI du dernier jour n'est pas pris).
    Ex. samedi après-midi : le samedi vaut 0 (son 0,5, c'est le matin)."""
    if end < start:
        raise ValueError("La date de fin est avant la date de début.")
    holidays = holiday_dates(start, end)  # une seule requête SQL pour toute la période

    values = []
    day = start
    while day <= end:
        morning, afternoon = (ZERO, ZERO) if day in holidays else HALVES[day.weekday()]
        if day == start and starts_afternoon:
            morning = ZERO
        if day == end and ends_noon:
            afternoon = ZERO
        values.append((day, morning + afternoon))
        day += datetime.timedelta(days=1)
    return values


def count_days(start, end, starts_afternoon=False, ends_noon=False):
    """Le nombre de jours du congé (ex. Decimal("2.5"))."""
    return sum((value for _, value in day_values(start, end, starts_afternoon, ends_noon)), ZERO)


def days_label(value):
    """Un nombre de jours lisible, à la française : Decimal("4.0") -> "4", Decimal("2.5") -> "2,5"."""
    return f"{value.normalize():f}".replace(".", ",")
