"""Step 3 : envoyer une demande de congé.

Le module Congés vérifie SES règles (dates, jours, maximum, chevauchement), puis il donne la demande
au moteur des circuits (engine.submit("LEAVE")), qui s'occupe de QUI valide.
Step 6 : l'aperçu (preview_leave), pour le formulaire : le calcul en direct, sans rien enregistrer.
"""
from django.core.exceptions import ValidationError
from django.db import transaction

from employees.models import Employee
from workflows import engine
from workflows.models import Workflow

from .balance import balance
from .counting import ZERO, day_values, days_label
from .models import LeaveRequest, PublicHoliday


def preview_leave(employee, leave_type, start_date, end_date, starts_afternoon=False, ends_noon=False):
    """Ce que le formulaire affiche pendant qu'on choisit les dates (rien n'est enregistré) :
    {"days": 2.5, "detail": [{"date", "days", "holiday"}...], "balance": {...}, "balance_after": 7.5, "error": None}.
    "error" = la règle qui bloquerait l'envoi (ex. "Solde insuffisant..."), pour la montrer AVANT de cliquer."""
    leave = LeaveRequest(employee=employee, leave_type=leave_type, start_date=start_date, end_date=end_date,
                         starts_afternoon=starts_afternoon, ends_noon=ends_noon)
    error = None
    try:
        leave.full_clean(exclude=["request", "days"])  # les mêmes règles que l'envoi
    except ValidationError as problem:
        error = problem.messages[0]

    detail = []
    if end_date >= start_date:
        names = dict(PublicHoliday.objects.filter(date__range=(start_date, end_date), is_active=True).values_list("date", "name"))
        detail = [{"date": day, "days": value, "holiday": names.get(day)}
                  for day, value in day_values(start_date, end_date, starts_afternoon, ends_noon)]
    days = sum((line["days"] for line in detail), ZERO)

    current = balance(employee)
    return {
        "days": days,
        "detail": detail,
        "balance": current,
        # Le solde après ce congé : seulement pour un type "décompté du solde" (sinon null : rien ne change).
        "balance_after": current["available"] - days if leave_type.deducts_balance else None,
        "error": error,
    }


@transaction.atomic
def request_leave(employee, leave_type, start_date, end_date, starts_afternoon=False, ends_noon=False, reason=""):
    """Ex. request_leave(sara, annuel, date(2026, 11, 23), date(2026, 11, 27)).
    transaction.atomic : si le moteur échoue, le congé n'est pas enregistré non plus (rien à moitié)."""
    # On VERROUILLE le collaborateur jusqu'à la fin : deux clics "Envoyer" en même temps passent l'un
    # après l'autre, et le second voit le premier congé (pas de chevauchement, ni de solde dépassé en step 4).
    Employee.objects.select_for_update().get(pk=employee.pk)
    leave = LeaveRequest(
        employee=employee, leave_type=leave_type, start_date=start_date, end_date=end_date,
        starts_afternoon=starts_afternoon, ends_noon=ends_noon, reason=reason.strip(),
    )
    # 1. Les règles du congé (clean() calcule aussi `days`). La demande du moteur n'existe pas encore :
    #    on ne vérifie pas ce champ-là ici.
    leave.full_clean(exclude=["request", "days"])

    # 2. Le circuit : le moteur crée la demande, trouve le N+1... et sonne la cloche.
    #    Le titre se lit dans "My requests" et dans la cloche des valideurs.
    title = f"{leave_type} du {start_date:%d/%m/%Y} au {end_date:%d/%m/%Y} ({days_label(leave.days)} j)"
    leave.request = engine.submit(Workflow.Code.LEAVE, employee, title)
    leave.save()
    return leave
