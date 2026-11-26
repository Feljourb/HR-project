"""Ce que la PAIE doit savoir quand quelqu'un part (2026-11-25, la procédure de départ du Code du travail).

L'application ne connaît pas les salaires (standard d'un SIRH sans paie) : elle donne les ÉLÉMENTS en jours / heures,
la paie les transforme en argent pour le solde de tout compte (le "reçu pour solde de tout compte", art. 73) :
- les congés à payer (art. 251 : les jours gagnés et pas pris sont payés au départ) ;
- les jours de préavis non effectués quand le salarié ne l'a pas respecté (art. 51 : retenus) ;
- l'indemnité de licenciement en HEURES de salaire (art. 52-53 : licenciement, pas pour faute grave, 6 mois minimum) ;
- et ce qu'il faut pour la déclaration de sortie à la CNSS (Damancom n'a pas d'API : les RH la font).
"""
from decimal import ROUND_HALF_UP, Decimal

from leaves.balance import balance
from leaves.models import LeaveRequest

from .models import DepartureType, JourneySettings, NoticeStatus


def months_between(start, end):
    """Les mois COMPLETS de start à end (embauché le 10/03/2023, dernier jour le 25/11/2026 : 44 mois)."""
    months = (end.year - start.year) * 12 + end.month - start.month
    return max(0, months - (1 if end.day < start.day else 0))


def dismissal_indemnity(departure):
    """L'indemnité de licenciement en HEURES de salaire (art. 53) : par tranche d'ancienneté, la grille d'Admin RH
    (par défaut 96 h / an les 5 premières années, 144 h de 5 à 10, 192 h de 10 à 15, 240 h au-delà ; une fraction
    d'année compte au prorata). Ex. 4 ans et 6 mois : 4,5 x 96 = 432 h. La paie : heures x salaire horaire.
    Pas d'indemnité : autre type de départ, faute grave (art. 39), moins de 6 mois d'ancienneté (art. 52)."""
    if departure.departure_type != DepartureType.DISMISSAL:
        return {"applies": False, "reason": "Only for a dismissal."}
    if departure.serious_misconduct:
        return {"applies": False, "reason": "Serious misconduct: no indemnity (art. 39)."}
    current = JourneySettings.load()
    months = months_between(departure.employee.hire_date, departure.last_day)
    if months < current.indemnity_min_months:
        return {"applies": False, "reason": f"Less than {current.indemnity_min_months} months of seniority (art. 52).", "months": months}
    years = Decimal(months) / 12
    steps = sorted((Decimal(str(start)), Decimal(str(hours))) for start, hours in (current.indemnity_hours or []))
    detail, total = [], Decimal(0)
    for index, (start, hours) in enumerate(steps):
        end = steps[index + 1][0] if index + 1 < len(steps) else None
        span = (min(years, end) if end is not None else years) - start
        if span <= 0:
            continue
        part = (span * hours).quantize(Decimal("0.01"), ROUND_HALF_UP)
        detail.append({"from_years": start, "to_years": end, "years": span.quantize(Decimal("0.01"), ROUND_HALF_UP),
                       "hours_per_year": hours, "hours": part})
        total += part
    return {"applies": True, "months": months, "years": years.quantize(Decimal("0.01"), ROUND_HALF_UP), "hours": total, "detail": detail}


def notice_days_to_deduct(departure):
    """Préavis NON respecté par le salarié (décision des RH) : les jours manquants, retenus par la paie (art. 51)."""
    return departure.notice_short_days if departure.notice_status == NoticeStatus.NOT_RESPECTED else 0


def cnss_data(departure):
    """Ce qu'il faut pour déclarer la sortie à la CNSS (Damancom) : les RH copient, déclarent, puis cochent la tâche."""
    employee = departure.employee
    return {"name": f"{employee.first_name} {employee.last_name}", "u_number": employee.u_number, "cin": employee.cin,
            "cnss_number": employee.cnss_number, "hire_date": employee.hire_date, "last_day": departure.last_day,
            "reason": departure.get_departure_type_display()}


def payroll(departure):
    """TOUT ce que la paie et la CNSS doivent savoir, en un seul endroit (le panneau des RH, et "Copy for payroll")."""
    return {
        "leave": leave_at_last_day(departure),
        "notice": {"status": departure.notice_status, "status_label": departure.get_notice_status_display(),
                   "short_days": departure.notice_short_days, "days_to_deduct": notice_days_to_deduct(departure),
                   # faute grave : la page dit POURQUOI il n'y a pas de préavis (art. 39), pas "pas de préavis pour ce type"
                   "serious": departure.departure_type == DepartureType.DISMISSAL and departure.serious_misconduct},
        "indemnity": dismissal_indemnity(departure),
        "cnss": cnss_data(departure),
    }


def leave_at_last_day(departure):
    """Le solde de congé AU DERNIER JOUR, avec le même moteur que le module Congés (les mois gagnés jusqu'au dernier
    jour, l'ancienneté, les jours périmés, les corrections RH, les congés pris ou en attente).
    Ex. 8 jours aujourd'hui + décembre gagné (1,5) = 9,5 jours à payer.
    + les congés (validés ou en attente) qui finissent APRÈS le dernier jour : les RH doivent les annuler (les jours
    reviennent tout seuls au solde)."""
    employee, last_day = departure.employee, departure.last_day
    at_last_day = balance(employee, today=last_day)
    after = (LeaveRequest.objects.filter(employee=employee, request__status__in=LeaveRequest.ACTIVE, end_date__gt=last_day)
             .select_related("leave_type", "request").order_by("start_date"))
    return {
        "on": last_day,
        "available": at_last_day["available"],  # > 0 : à payer ; < 0 : pris en trop (la paie le retient)
        "acquired": at_last_day["acquired"],
        "adjusted": at_last_day["adjusted"],
        "taken": at_last_day["taken"],
        "pending": at_last_day["pending"],
        "expired": at_last_day["expired"],
        "leaves_after": [{
            "request": leave.request_id, "type": leave.leave_type.name, "start_date": leave.start_date,
            "end_date": leave.end_date, "days": leave.days, "status": leave.request.status,
        } for leave in after],
    }
