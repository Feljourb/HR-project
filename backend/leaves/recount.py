"""Recalculer les congés quand un jour férié change (décision du 2026-11-03 : le standard des logiciels RH).

Comme une caisse qui s'est trompée de prix : si Admin RH ajoute, déplace, désactive ou réactive un jour férié,
chaque congé (en cours ou accepté) qui touche l'ancienne OU la nouvelle date est recompté :
1. le nouveau nombre de jours remplace l'ancien (le solde suit tout seul : il se calcule avec) ;
2. une trace : LeaveRecount (avant -> après, pourquoi, qui) ;
3. la cloche : le collaborateur est prévenu ; les RH du pôle aussi, s'il y a un point à vérifier.

L'application ne refuse et n'annule JAMAIS un congé toute seule : elle recompte et prévient, l'humain décide.
- Solde négatif (un jour férié en moins sur un congé déjà accepté) : permis ICI, les RH sont prévenus.
- Maximum du type dépassé (ex. mariage : 5 jours au lieu de 4) : gardé, les RH sont prévenus.
- 0 jour (le seul jour du congé devient férié) : gardé ; le collaborateur peut l'annuler.
Un congé refusé ou annulé ne compte nulle part : rien à faire. Une année passée est fermée (urls.py).
Appelé par la page Reference lists (urls.py) et par /admin (admin.py), là où un jour férié change.
"""
from django.db import transaction
from django.db.models import Q

from employees.models import Notification
from workflows import engine

from .balance import balance
from .counting import count_days, days_label
from .models import LeaveRecount, LeaveRequest
from .services import leave_title


def describe(holiday, before):
    """Ce qui a changé, en clair, ex. "Aïd Al Fitr déplacé : 20/03/2026 -> 21/03/2026"."""
    if before is None:
        return f"Jour férié ajouté : {holiday.name} ({holiday.date:%d/%m/%Y})"
    old_date, was_active = before
    if was_active and not holiday.is_active:
        return f"Jour férié désactivé : {holiday.name} ({old_date:%d/%m/%Y})"
    if holiday.is_active and not was_active:
        return f"Jour férié réactivé : {holiday.name} ({holiday.date:%d/%m/%Y})"
    return f"{holiday.name} déplacé : {old_date:%d/%m/%Y} -> {holiday.date:%d/%m/%Y}"


def warning_for(leave, old_days):
    """Le point que les RH doivent regarder après le recalcul, ou "" (tout va bien)."""
    if leave.days == 0:
        return "Ce congé ne compte plus aucun jour."
    maximum = leave.leave_type.max_days
    if maximum is not None and leave.days > maximum:
        return f"Dépasse le maximum de « {leave.leave_type} » ({days_label(maximum)} j)."
    if leave.leave_type.deducts_balance and leave.days > old_days:
        available = balance(leave.employee)["available"]  # déjà avec le nouveau nombre de jours
        if available < 0:
            return f"Solde négatif : {days_label(available)} j."
    return ""


def notify(leave, warning):
    """La cloche : toujours le collaborateur ; les RH du pôle (et Admin RH) seulement s'il y a un point à vérifier."""
    recipients = [leave.employee.user] if leave.employee.user_id else []
    if warning:
        recipients += list(engine.hr_validators(leave.employee))
    Notification.objects.bulk_create(
        Notification(recipient=user, employee=leave.employee, kind=Notification.Kind.RECOUNTED, request=leave.request)
        for user in dict.fromkeys(recipients)  # dict.fromkeys : sans doublon, dans l'ordre
    )


@transaction.atomic
def holiday_changed(holiday, before=None, user=None):
    """Recompte les congés touchés par ce jour férié. `before` = (date, actif ?) AVANT le changement,
    ou None pour un jour férié ajouté. Renvoie les congés qui ont changé."""
    if before == (holiday.date, holiday.is_active):
        return []  # seulement le nom ou "estimée" : aucun jour ne change
    # Les jours qui changent de prix : l'ancienne date (si elle était fériée) et la nouvelle (si elle l'est).
    days = {day for day, active in [before or (None, False), (holiday.date, holiday.is_active)] if active}
    if not days:
        return []
    touches = Q()
    for day in days:
        touches |= Q(start_date__lte=day, end_date__gte=day)
    # Verrouillés : un congé envoyé ou validé en même temps attend la fin du recalcul.
    leaves = (LeaveRequest.objects.filter(touches, request__status__in=LeaveRequest.ACTIVE)
              .select_related("leave_type", "employee", "request").select_for_update(of=("self",)))

    reason = describe(holiday, before)
    changed = []
    for leave in leaves:
        # Un congé en jours CALENDAIRES (ex. maternité) compte déjà les fériés : son total ne change pas.
        new_days = count_days(leave.start_date, leave.end_date, leave.starts_afternoon, leave.ends_noon,
                              calendar=leave.leave_type.in_calendar_days, full_saturday=leave.employee.works_full_saturday)
        if new_days == leave.days:
            continue  # ex. l'Aïd déplacé du 20 au 21, les deux DANS le congé : même total
        old_days, leave.days = leave.days, new_days
        leave.save(update_fields=["days"])
        leave.request.title = leave_title(leave)  # "(4 j)" -> "(3 j)" dans My requests et la cloche
        leave.request.save(update_fields=["title"])
        warning = warning_for(leave, old_days)
        LeaveRecount.objects.create(leave=leave, old_days=old_days, new_days=new_days, reason=reason,
                                    warning=warning, changed_by=user)
        notify(leave, warning)
        changed.append(leave)
    return changed
