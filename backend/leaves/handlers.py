"""Step 5 : ce que fait le module Congés quand le moteur dit "demande acceptée".

Presque rien à écrire : le statut se lit dans request.status, et le solde est recalculé à chaque fois
(le congé passe tout seul de "en attente" à "pris"). Il reste UNE vérification de sécurité :
entre l'envoi et la dernière validation, le solde a pu baisser (ex. le RH a corrigé le droit annuel
de la fiche). Si le congé ne rentre plus dans le solde, on bloque l'acceptation : le valideur doit refuser.
"""
from django.core.exceptions import ValidationError

from workflows.engine import on_absence_check, on_approved
from workflows.models import Request, Workflow

from .balance import balance
from .counting import days_label
from .models import LeaveRequest


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
