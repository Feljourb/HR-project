"""Step 4 : le solde de congé d'un collaborateur.

Une TIRELIRE PAR ANNÉE (décision du 2026-11-02) :
- Depuis le jour de l'embauche, chaque mois COMPLET travaillé rapporte : droit annuel / 12 (18 -> 1,5 ; 30 -> 2,5).
  Droit annuel = le droit valable ce mois-là (Employee.annual_leave_days depuis l'embauche, puis les
  changements AnnualRightChange à partir de leur date, P1 step 2) + l'ancienneté (1,5 par 5 ans), au maximum 36.
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

from .models import AnnualRightChange, LeaveRequest, LeaveSettings

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


def right_changes(employee):
    """Les changements du droit annuel (P1 step 2), du plus ancien au plus récent : [(à partir du, jours), ...]."""
    if employee.pk is None:
        return []  # une fiche pas encore enregistrée
    return list(AnnualRightChange.objects.filter(employee=employee).order_by("effective_from")
                .values_list("effective_from", "annual_days"))


def right_on(employee, day, changes=None):
    """Le droit annuel (sans l'ancienneté) valable CE jour-là : le dernier changement déjà commencé,
    sinon le droit de la fiche (depuis l'embauche). Ex. 18 jusqu'au 31/08, 30 à partir du 01/09.
    `changes` : déjà lus (monthly_earnings les lit UNE fois pour tous les mois)."""
    right = employee.annual_leave_days
    for start, days in right_changes(employee) if changes is None else changes:
        if start > day:
            break
        right = days
    return right


def yearly_right(employee, settings, on_day, changes=None):
    """Le droit annuel de ce collaborateur à cette date : son droit + l'ancienneté, au maximum le plafond."""
    periods = full_years(employee.hire_date, on_day) // settings.seniority_years if settings.seniority_years else 0
    return min(right_on(employee, on_day, changes) + periods * settings.seniority_bonus, settings.max_days_per_year)


def monthly_earnings(employee, today, settings):
    """Ce que chaque mois complet a rapporté depuis l'embauche : [(fin du mois, jours), ...]."""
    # Un collaborateur "Sorti" ne gagne plus rien après sa date de sortie.
    end = min(today, employee.departure_date) if employee.departure_date else today
    changes = right_changes(employee)  # une seule requête pour tous les mois
    earnings, months = [], 1
    # Toujours compté depuis l'embauche (pas mois après mois) : 31/01 -> 28/02 -> 31/03, sans glisser au 28.
    while add_months(employee.hire_date, months) <= end:
        month_end = add_months(employee.hire_date, months)
        # Le droit ET l'ancienneté sont lus à la fin de CE mois : une promotion le 01/09 compte pour le mois
        # qui finit après (rien n'est donné pour les mois d'avant), le bonus commence le mois des 5 ans.
        earnings.append((month_end, yearly_right(employee, settings, month_end, changes) / 12))
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


def fill_and_pay(employee, today, settings, exclude=None):
    """Le cœur du calcul (utilisé par balance() et balance_by_year()) :
    1. remplir les tirelires : année -> jours gagnés cette année-là ;
    2. payer les congés, du plus ancien au plus récent, avec la tirelire valable la plus ancienne.
    Renvoie (gagné par année, reste par année, pris, en attente, manquant)."""
    earned = {}
    for month_end, days in monthly_earnings(employee, today, settings):
        earned[month_end.year] = earned.get(month_end.year, ZERO) + days
    pools = dict(earned)

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
    return earned, pools, taken, pending, missing


def balance(employee, today=None, exclude=None):
    """Le solde complet, ex. {"acquired": 40.5, "taken": 5, "pending": 2.5, "expired": 3, "available": 30,
    "expiring": {"days": 4, "on": date(2026, 12, 31)}}. acquired = taken + pending + expired + available.
    `exclude` : un congé à ne pas compter (celui qu'on est en train de vérifier)."""
    settings = LeaveSettings.load()
    today = today or timezone.localdate()
    _, pools, taken, pending, missing = fill_and_pay(employee, today, settings, exclude)

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


def balance_by_year(employee, today=None):
    """Le détail des tirelires, pour le panneau RH (comme les grands logiciels RH) :
    [{"year": 2025, "earned": 16.5, "used": 16.5, "left": 0, "valid_until": date(2026, 12, 31), "state": "VALID"}, ...]
    state : VALID (se dépense encore), EXPIRING (perdue le 31/12 de cette année), EXPIRED (déjà perdue)."""
    settings = LeaveSettings.load()
    today = today or timezone.localdate()
    earned, pools, *_ = fill_and_pay(employee, today, settings)
    rows = []
    for year in sorted(earned):
        until = expiry(year, settings)
        state = "EXPIRED" if until < today else "EXPIRING" if until.year == today.year else "VALID"
        rows.append({"year": year, "earned": money(earned[year]), "used": money(earned[year] - pools[year]),
                     "left": money(pools[year]), "valid_until": until, "state": state})
    return rows
