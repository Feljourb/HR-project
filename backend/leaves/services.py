"""Step 3 : envoyer une demande de congé.

Le module Congés vérifie SES règles (dates, jours, maximum, chevauchement), puis il donne la demande
au moteur des circuits (engine.submit("LEAVE")), qui s'occupe de QUI valide.
Step 6 : l'aperçu (preview_leave), pour le formulaire : le calcul en direct, sans rien enregistrer.
"""
from django.core.exceptions import PermissionDenied, ValidationError
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
                  for day, value in day_values(start_date, end_date, starts_afternoon, ends_noon, leave_type.in_calendar_days)]
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
    leave.request = engine.submit(Workflow.Code.LEAVE, employee, leave_title(leave))
    leave.save()
    return leave


def can_manage_balance(user, employee):
    """P1 steps 2-3 : qui change le droit annuel et corrige le solde : les RH du pôle et Admin RH
    (comme pour valider : jamais pour soi-même), et l'IT (support)."""
    return user.is_superuser or engine.hr_validators(employee).filter(pk=user.pk).exists()


@transaction.atomic
def add_adjustment(employee, days, date, reason, user):
    """P1 step 3 : une correction du solde, ex. add_adjustment(youssef, -10, date(2025, 12, 31),
    "Congés 2025 pris avant l'application (Excel RH)", nadia.user). Le solde change tout seul (voir balance.py).
    Une ligne aussi dans l'historique de la fiche (onglet History et Audit log)."""
    from employees import history
    from employees.models import EmployeeHistory

    from .models import BalanceAdjustment

    if not can_manage_balance(user, employee):
        raise PermissionDenied("Seuls les RH du pôle (et Admin RH) corrigent le solde.")
    if not (reason or "").strip():
        raise ValidationError({"reason": "Indiquez le motif (ex. « Congés pris avant l'application »)."})
    adjustment = BalanceAdjustment(employee=employee, days=days, date=date, reason=reason.strip(), created_by=user)
    adjustment.full_clean()
    adjustment.save()
    sign = "+" if adjustment.days > 0 else "-"
    history.record(employee, user, EmployeeHistory.Action.UPDATED, [{
        "field": "Correction du solde de congé",
        "old": "",
        "new": f"{sign}{days_label(abs(adjustment.days))} j au {date:%d/%m/%Y} ({adjustment.reason})",
    }])
    tell_employee(employee, "BALANCE_ADJUSTED")
    return adjustment


@transaction.atomic
def change_annual_right(employee, annual_days, effective_from, reason, user):
    """Ex. change_annual_right(sara, 30, date(2026, 9, 1), "Promotion manager", nadia.user).
    Le solde change tout seul (il lit le droit mois par mois). Une ligne aussi dans l'historique de la fiche
    (onglet History et Audit log), comme toute modification du dossier."""
    from employees import history
    from employees.models import EmployeeHistory

    from .balance import right_on
    from .models import AnnualRightChange

    if not can_manage_balance(user, employee):
        raise PermissionDenied("Seuls les RH du pôle (et Admin RH) changent le droit annuel.")
    if not (reason or "").strip():
        raise ValidationError({"reason": "Indiquez le motif (ex. « Promotion manager »)."})
    old = right_on(employee, effective_from)
    change = AnnualRightChange(employee=employee, annual_days=annual_days, effective_from=effective_from,
                               reason=reason.strip(), changed_by=user)
    change.full_clean()
    change.save()
    history.record(employee, user, EmployeeHistory.Action.UPDATED, [{
        "field": "Droit annuel de congé",
        "old": days_label(old),
        "new": f"{days_label(change.annual_days)} à partir du {effective_from:%d/%m/%Y} ({change.reason})",
    }])
    tell_employee(employee, "RIGHT_CHANGED")
    return change


def tell_employee(employee, kind):
    """🔔 Le collaborateur est prévenu quand les RH changent SON solde (correction ou droit annuel) :
    il voit le chiffre et le motif (le texte est calculé à l'affichage, employees/notifications.py)."""
    from employees.models import Notification

    if employee.user_id:
        Notification.objects.create(recipient=employee.user, employee=employee, kind=kind)


@transaction.atomic
def record_leave(employee, leave_type, start_date, end_date, user, starts_afternoon=False, ends_noon=False, reason=""):
    """P1 step 4b : les RH enregistrent un congé À LA PLACE du collaborateur (ex. une maladie qu'il n'a pas pu
    demander à temps). Les mêmes règles que request_leave (chevauchement, maximum, solde, 6 mois, pas avant
    l'embauche), SAUF "pas trop loin dans le passé". Déjà ACCEPTÉ (standard : les RH sont l'autorité) :
    pas de circuit, l'historique dit "Validée par <RH> : Enregistré par les RH", le collaborateur est prévenu."""
    if not can_manage_balance(user, employee):
        raise PermissionDenied("Seuls les RH du pôle (et Admin RH) enregistrent un congé pour un collaborateur.")
    Employee.objects.select_for_update().get(pk=employee.pk)  # comme request_leave : deux envois l'un après l'autre
    leave = LeaveRequest(
        employee=employee, leave_type=leave_type, start_date=start_date, end_date=end_date,
        starts_afternoon=starts_afternoon, ends_noon=ends_noon, reason=reason.strip(), recorded_by=user,
    )
    leave.full_clean(exclude=["request", "days"])
    comment = "Enregistré par les RH" + (f" : {leave.reason}" if leave.reason else "")
    leave.request = engine.record_approved(Workflow.Code.LEAVE, employee, leave_title(leave), user, comment)
    leave.save()
    return leave


@transaction.atomic
def cancel_leave(leave, user, reason):
    """P1 step 5 : annuler un congé DÉJÀ ACCEPTÉ, avant son premier jour, avec un motif (standard).
    Qui : le collaborateur lui-même, ou les RH du pôle / Admin RH. Un congé déjà commencé ne s'annule pas
    (les RH corrigent le solde à la place). Les jours reviennent tout seuls dans le solde (un congé annulé
    ne compte plus) ; ceux qui l'avaient validé sont prévenus (engine.cancel_approved)."""
    from django.utils import timezone

    if user.pk != leave.employee.user_id and not can_manage_balance(user, leave.employee):
        raise PermissionDenied("Seuls le collaborateur et les RH du pôle peuvent annuler ce congé.")
    if leave.start_date <= timezone.localdate():
        raise ValidationError("Ce congé a déjà commencé : il ne peut plus être annulé (les RH peuvent corriger le solde).")
    engine.cancel_approved(leave.request, user, reason)
    return leave


def can_open_document(user, leave):
    """P2 step 4 : qui ouvre / envoie le justificatif d'un congé : le collaborateur lui-même, et les RH de son pôle
    (Admin RH, IT). PAS le N+1 : un certificat médical est une donnée de santé (il voit seulement reçu / manquant)."""
    return user.pk == leave.employee.user_id or can_manage_balance(user, leave.employee)


@transaction.atomic
def attach_document(leave, file, user):
    """P2 step 4 : joindre (ou remplacer) le justificatif d'un congé, avec la demande ou plus tard (ex. le certificat
    arrive le lendemain). Un congé refusé ou annulé n'en a plus besoin."""
    from django.utils import timezone

    from workflows.models import Request

    if not can_open_document(user, leave):
        raise PermissionDenied("Seuls le collaborateur et les RH de son pôle envoient ce justificatif.")
    if leave.request.status not in (Request.Status.IN_PROGRESS, Request.Status.APPROVED):
        raise ValidationError("Ce congé est refusé ou annulé : pas de justificatif à envoyer.")
    leave.document, leave.document_name, leave.document_at = file, file.name[:200], timezone.now()
    # Seulement les règles du FICHIER (pdf / jpg / png, 5 Mo) : pas celles du congé (déjà vérifié à l'envoi ;
    # ex. une maladie d'hier serait refusée aujourd'hui par la règle "dans le passé").
    leave.clean_fields(exclude=[field.name for field in LeaveRequest._meta.fields if field.name != "document"])
    leave.save(update_fields=["document", "document_name", "document_at"])
    return leave


def leave_title(leave):
    """Le titre de la demande, ex. "Congé annuel du 23/11/2026 au 27/11/2026 (5 j)".
    Refait après un recalcul (recount.py) : le nombre de jours du titre reste juste."""
    return f"{leave.leave_type} du {leave.start_date:%d/%m/%Y} au {leave.end_date:%d/%m/%Y} ({days_label(leave.days)} j)"
