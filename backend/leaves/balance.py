"""Step 4 : le solde de congé d'un collaborateur.

Une TIRELIRE PAR ANNÉE (décision du 2026-11-02) :
- Depuis le jour de l'embauche, chaque mois COMPLET travaillé rapporte : droit annuel / 12 (18 -> 1,5 ; 30 -> 2,5).
  Droit annuel = Employee.annual_leave_days + l'ancienneté (1,5 par période de 5 ans), au maximum 36.
  Le mois rapporte dans la tirelire de SON année (gagné en mars 2026 -> tirelire 2026).
- Une tirelire se vide pendant 2 ans (LeaveSettings.carry_over_years) : celle de 2026 jusqu'au 31/12/2027.
  Après, ce qui reste est PERDU ("expired").
- Un congé (seulement les types "décomptés du solde") se paie avec la tirelire la plus ANCIENNE encore valable
  à sa date : on utilise d'abord les jours qui vont bientôt être perdus.
- Disponible = ce qui reste dans les tirelires encore valables aujourd'hui.
Rien n'est stocké : le solde est recalculé à chaque fois (pas de chiffre qui se désynchronise).
"""
import calendar
import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from workflows.models import Request

from .models import LeaveRequest, LeaveSettings

ZERO, CENT = Decimal("0"), Decimal("0.01")


def add_months(day, months):
    """Le même jour, n mois plus tard. Un jour qui n'existe pas devient le dernier du mois
    (31 janvier + 1 mois -> 28 février)."""
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return day.replace(year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1]))


def full_years(start, end):
    """Les années complètes entre deux dates (l'ancienneté). Ex. 10/03/2020 -> 09/03/2026 : 5 ans."""
    return end.year - start.year - ((end.month, end.day) < (start.month, start.day))


def yearly_right(employee, settings, on_day):
    """Le droit annuel de ce collaborateur à cette date : son droit + l'ancienneté, au maximum le plafond."""
    periods = full_years(employee.hire_date, on_day) // settings.seniority_years if settings.seniority_years else 0
    return min(employee.annual_leave_days + periods * settings.seniority_bonus, settings.max_days_per_year)


def monthly_earnings(employee, today, settings):
    """Ce que chaque mois complet a rapporté depuis l'embauche : [(fin du mois, jours), ...]."""
    # Un collaborateur "Sorti" ne gagne plus rien après sa date de sortie.
    end = min(today, employee.departure_date) if employee.departure_date else today
    earnings, months = [], 1
    # Toujours compté depuis l'embauche (pas mois après mois) : 31/01 -> 28/02 -> 31/03, sans glisser au 28.
    while add_months(employee.hire_date, months) <= end:
        month_end = add_months(employee.hire_date, months)
        # L'ancienneté est lue à la fin de CE mois : le bonus commence le mois des 5 ans.
        earnings.append((month_end, yearly_right(employee, settings, month_end) / 12))
        months += 1
    return earnings


def expiry(year, settings):
    """Le dernier jour où la tirelire de cette année se dépense (2026 -> 31/12/2027 avec 2 ans)."""
    return datetime.date(year + settings.carry_over_years - 1, 12, 31)


def money(value):
    return value.quantize(CENT, ROUND_HALF_UP)  # ex. 19,5 / 12 = 1,625 par mois


def acquired(employee, today=None, settings=None):
    """Tous les jours gagnés depuis l'embauche (même ceux perdus depuis)."""
    settings = settings or LeaveSettings.load()
    return money(sum((days for _, days in monthly_earnings(employee, today or timezone.localdate(), settings)), ZERO))


def balance(employee, today=None, exclude=None):
    """Le solde complet, ex. {"acquired": 40.5, "taken": 5, "pending": 2.5, "expired": 3, "available": 30,
    "expiring": {"days": 4, "on": date(2026, 12, 31)}}. acquired = taken + pending + expired + available.
    `exclude` : un congé à ne pas compter (celui qu'on est en train de vérifier)."""
    settings = LeaveSettings.load()
    today = today or timezone.localdate()

    # 1. Remplir les tirelires : année -> jours gagnés cette année-là.
    pools = {}
    for month_end, days in monthly_earnings(employee, today, settings):
        pools[month_end.year] = pools.get(month_end.year, ZERO) + days

    # 2. Payer les congés, du plus ancien au plus récent, avec la tirelire valable la plus ancienne.
    leaves = (LeaveRequest.objects.filter(employee=employee, leave_type__deducts_balance=True,
                                          request__status__in=LeaveRequest.ACTIVE)
              .exclude(pk=exclude).order_by("start_date").values_list("start_date", "days", "request__status"))
    taken = pending = missing = ZERO
    for start, days, status in leaves:
        if status == Request.Status.APPROVED:
            taken += days
        else:
            pending += days
        rest = days
        for year in sorted(pools):
            if rest <= 0:
                break
            if expiry(year, settings) >= start:  # encore valable à la date du congé
                used = min(rest, pools[year])
                pools[year] -= used
                rest -= used
        missing += rest  # pas assez dans les tirelires (ex. le RH a baissé le droit) : le disponible devient négatif

    # 3. Ce qui reste : perdu (tirelire périmée aujourd'hui) ou disponible.
    valid = [year for year in sorted(pools) if expiry(year, settings) >= today]
    expired = sum((left for year, left in pools.items() if year not in valid), ZERO)
    available = sum((pools[year] for year in valid), ZERO) - missing
    # Les jours qui seront perdus à la fin de CETTE année, pour prévenir le collaborateur.
    soon = [year for year in valid if expiry(year, settings).year == today.year and pools[year] > 0]
    return {
        "acquired": money(sum(pools.values(), ZERO) + taken + pending - missing),
        "taken": money(taken),
        "pending": money(pending),
        "expired": money(expired),
        "available": money(available),
        "expiring": {"days": money(pools[soon[0]]), "on": expiry(soon[0], settings)} if soon else None,
    }
