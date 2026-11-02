"""Step 4 : le solde de congé d'un collaborateur (la "tirelire").

- La tirelire part de 0 (à LeaveSettings.counting_start, ou à l'embauche si elle est après).
- Chaque mois COMPLET travaillé, elle gagne : droit annuel / 12 (18 -> 1,5 ; 30 -> 2,5).
  Droit annuel = Employee.annual_leave_days + l'ancienneté (1,5 par période de 5 ans), au maximum 36.
- Disponible = acquis - pris (congés acceptés) - en attente (congés en cours de validation).
  Seuls les types "décomptés du solde" comptent (congé annuel) ; mariage, maladie... non.
- Rien n'expire : ce qui n'est pas pris reste pour l'année d'après (v1).
Rien n'est stocké : le solde est recalculé à chaque fois (pas de chiffre qui se désynchronise).
"""
import calendar
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
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


def acquired(employee, today=None, settings=None):
    """Les jours gagnés depuis le début du calcul, mois complet par mois complet."""
    settings = settings or LeaveSettings.load()
    today = today or timezone.localdate()
    start = max(employee.hire_date, settings.counting_start)
    # Un collaborateur "Sorti" ne gagne plus rien après sa date de sortie.
    end = min(today, employee.departure_date) if employee.departure_date else today

    total, months = ZERO, 1
    # Toujours compté depuis `start` (pas mois après mois) : 31/01 -> 28/02 -> 31/03, sans glisser au 28.
    while add_months(start, months) <= end:
        # L'ancienneté est lue à la fin de CE mois : le bonus commence le mois des 5 ans.
        total += yearly_right(employee, settings, add_months(start, months)) / 12
        months += 1
    return total.quantize(CENT, ROUND_HALF_UP)  # ex. 19,5 / 12 = 1,625 par mois


def days_of(employee, status, exclude=None):
    """Le total des jours des congés "décomptés du solde" de ce collaborateur, avec ce statut."""
    leaves = LeaveRequest.objects.filter(employee=employee, leave_type__deducts_balance=True, request__status=status)
    if exclude is not None:
        leaves = leaves.exclude(pk=exclude)  # le congé qu'on est en train de vérifier ne se compte pas lui-même
    return leaves.aggregate(total=Sum("days"))["total"] or ZERO


def balance(employee, today=None, exclude=None):
    """Le solde complet : {"acquired": 13.5, "taken": 5, "pending": 2.5, "available": 6}."""
    result = {
        "acquired": acquired(employee, today),
        "taken": days_of(employee, Request.Status.APPROVED, exclude),
        "pending": days_of(employee, Request.Status.IN_PROGRESS, exclude),
    }
    result["available"] = result["acquired"] - result["taken"] - result["pending"]
    return result
