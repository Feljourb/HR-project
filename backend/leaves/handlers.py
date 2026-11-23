"""Step 5 : ce que fait le module Congés quand le moteur dit "demande acceptée".

Presque rien à écrire : le statut se lit dans request.status, et le solde est recalculé à chaque fois
(le congé passe tout seul de "en attente" à "pris"). Il reste UNE vérification de sécurité :
entre l'envoi et la dernière validation, le solde a pu baisser (ex. le RH a corrigé le droit annuel
de la fiche). Si le congé ne rentre plus dans le solde, on bloque l'acceptation : le valideur doit refuser.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from employees.models import Employee, Notification
from employees.notifications import on_bell_refresh, on_morning_round
from employees.services import user_pole
from workflows import engine
from workflows.engine import on_absence_check, on_approved
from workflows.models import Request, Workflow

from .balance import balance
from .counting import days_label
from .models import LeaveRequest


EXPIRING_FROM_MONTH = 11  # le rappel "jours bientôt perdus" à partir du 1er novembre (2 mois avant le 31/12)
WARN_DAYS_BEFORE = 2      # "pas encore validée" : 2 jours avant le premier jour du congé (décision du 2026-11-12)
EXPIRED_REASON = "Pas validée avant le premier jour du congé : les jours réservés sont rendus au solde."


@on_bell_refresh
def warn_not_validated(user):
    """2026-11-12 : un valideur absent sans délégué n'est remplacé par personne, la demande l'attend. Pour ne pas
    découvrir le problème le jour même : de 2 jours avant le début du congé jusqu'au jour du début, une demande
    ENCORE EN ATTENTE prévient (🔔 + email "Pas encore validée", une fois : due_date = le 1er jour) le demandeur
    (il peut appeler son N+1, ou décaler) et les RH de son pôle + les Admin RH (ils peuvent relancer le N+1).
    Les RH ne valident PAS à sa place : c'est seulement une information."""
    today = timezone.localdate()
    waiting = (LeaveRequest.objects.filter(request__status=Request.Status.IN_PROGRESS,
                                           start_date__gte=today, start_date__lte=today + timedelta(days=WARN_DAYS_BEFORE))
               .select_related("request", "employee__department__direction__entity__pole"))
    Role = get_user_model().Role
    if user.role == Role.HR_ADMIN:
        mine = waiting  # Admin RH : les deux pôles
    elif user.role == Role.HR:
        pole = user_pole(user)
        mine = waiting.filter(employee__department__direction__entity__pole=pole) if pole else waiting.filter(employee__user=user)
    else:
        mine = waiting.filter(employee__user=user)  # le demandeur : ses propres demandes
    Notification.objects.bulk_create(
        [Notification(recipient=user, employee=leave.employee, kind=Notification.Kind.NOT_VALIDATED,
                      request=leave.request, due_date=leave.start_date) for leave in mine],
        ignore_conflicts=True)


@on_morning_round
def expire_unvalidated_leaves():
    """2026-11-12 (le standard "délai dépassé -> annulation automatique") : pas de congé sans la validation du N+1.
    Le jour du début (ou après, si le facteur était arrêté), une demande ENCORE EN ATTENTE est annulée par
    l'application : les jours réservés ("en attente") reviennent tout seuls au solde (une demande annulée ne
    compte nulle part). Prévenus : le demandeur, le valideur (et son délégué), les RH du pôle + Admin RH.
    Si la personne s'est absentée quand même, les RH décident (ex. "Record a leave" dans Leave balances)."""
    today = timezone.localdate()
    late = LeaveRequest.objects.filter(request__status=Request.Status.IN_PROGRESS, start_date__lte=today).select_related("request", "employee")
    for leave in late:
        engine.expire(leave.request, EXPIRED_REASON, also=list(engine.hr_validators(leave.employee)))


@on_bell_refresh
def remind_expiring_days(user):
    """P3 (rappel, standard) : à partir de novembre, "X jours de votre solde seront perdus le 31/12 : pensez à les
    prendre". Une seule fois par an (due_date = ce 31/12 + la contrainte unique). Plus rien à perdre (il a pris
    ses congés) : le rappel pas encore lu s'en va."""
    if timezone.localdate().month < EXPIRING_FROM_MONTH:
        return
    employee = Employee.objects.filter(user=user).exclude(status=Employee.Status.LEFT).first()
    if employee is None:
        return
    expiring = balance(employee)["expiring"]
    if expiring and expiring["days"] > 0:
        Notification.objects.bulk_create([Notification(recipient=user, employee=employee, kind=Notification.Kind.EXPIRING,
                                                       due_date=expiring["on"])], ignore_conflicts=True)
    else:
        Notification.objects.filter(recipient=user, kind=Notification.Kind.EXPIRING, read_at__isnull=True).delete()


@on_absence_check
def on_approved_leave(employee, day):
    """P2 step 1 : le moteur demande "cette personne est-elle absente ce jour-là ?" (pour faire répondre quelqu'un
    à la place d'un valideur absent). Absente = un congé ACCEPTÉ qui couvre ce jour (quel que soit le type)."""
    return LeaveRequest.objects.filter(employee=employee, request__status=Request.Status.APPROVED,
                                       start_date__lte=day, end_date__gte=day).exists()


@on_approved(Workflow.Code.LEAVE)
def confirm_leave(request):
    leave = LeaveRequest.objects.select_related("leave_type", "employee").filter(request=request).first()
    if leave is None:
        return  # une demande de démonstration (make seed-requests / send-request) : pas de dates, rien à vérifier
    if not leave.leave_type.deducts_balance:
        return  # mariage, maladie... : pas de solde
    available = balance(leave.employee, exclude=leave.pk)["available"]
    if leave.days > available:
        # Une erreur ici annule TOUTE l'acceptation (approve() est dans une transaction) :
        # l'étape reste "à traiter", et le valideur voit ce message.
        raise ValidationError(
            f"Solde insuffisant : {days_label(max(available, 0))} jour(s) disponible(s), "
            f"ce congé en compte {days_label(leave.days)}. Refusez la demande."
        )
