"""Step 5 : ce que fait le module Congés quand le moteur dit "demande acceptée".

Presque rien à écrire : le statut se lit dans request.status, et le solde est recalculé à chaque fois
(le congé passe tout seul de "en attente" à "pris"). Il reste UNE vérification de sécurité :
entre l'envoi et la dernière validation, le solde a pu baisser (ex. le RH a corrigé le droit annuel
de la fiche). Si le congé ne rentre plus dans le solde, on bloque l'acceptation : le valideur doit refuser.
"""
from django.core.exceptions import ValidationError

from workflows.engine import on_approved
from workflows.models import Workflow

from .balance import balance
from .counting import days_label
from .models import LeaveRequest


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
