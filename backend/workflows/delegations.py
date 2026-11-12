"""P2 step 1 : les délégations ("absent du bureau") d'un valideur.

Ex. Youssef part du 10 au 20/11 : "mes demandes vont aussi à Karim". Pendant la période, Karim les voit dans
"Team approvals" et y répond À LA PLACE de Youssef (l'historique dit "pour Youssef"). Le moteur s'en sert dans
engine.stand_in (niveau 1, avant "son responsable" puis "les RH").
"""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from employees.models import Notification

from . import engine, notify
from .models import Delegation, RequestStep


def can_manage(user, delegator):
    """Qui choisit le délégué de quelqu'un : la personne elle-même, ou les RH de son pôle / Admin RH (ex. une absence
    soudaine : elle ne peut pas le faire), et l'IT (support)."""
    return (user.is_superuser or delegator.user_id == user.pk
            or engine.hr_validators(delegator).filter(pk=user.pk).exists())


@transaction.atomic
def create_delegation(delegator, delegate, start_date, end_date, user):
    if not can_manage(user, delegator):
        raise PermissionDenied("Seuls la personne elle-même et les RH de son pôle choisissent son délégué.")
    delegation = Delegation(delegator=delegator, delegate=delegate, start_date=start_date, end_date=end_date, created_by=user)
    delegation.full_clean()
    delegation.save()
    # 🔔 Le délégué est prévenu ; si la période a déjà commencé, il reçoit aussi les demandes qui attendent déjà.
    Notification.objects.create(recipient=delegate.user, employee=delegator, kind=Notification.Kind.DELEGATED)
    if delegation.start_date <= timezone.localdate():
        waiting = RequestStep.objects.filter(assignee=delegator, status=RequestStep.Status.PENDING).select_related("request")
        for step in waiting:
            if step.request.requester_id != delegate.pk:
                Notification.objects.create(recipient=delegate.user, employee=step.request.requester,
                                            kind=Notification.Kind.TO_VALIDATE, request=step.request)
    return delegation


def end_delegation(delegation, user):
    """"End now" : la délégation s'arrête tout de suite (elle reste dans l'historique)."""
    if not can_manage(user, delegation.delegator):
        raise PermissionDenied("Seuls la personne elle-même et les RH de son pôle terminent cette délégation.")
    if delegation.ended_at or delegation.end_date < timezone.localdate():
        raise ValidationError("Cette délégation est déjà terminée.")
    delegation.ended_at = timezone.now()
    delegation.save(update_fields=["ended_at"])
    # 🔔 Ce qui attendait l'absent quitte tout de suite la cloche du délégué (pas encore lu),
    # et le délégué est prévenu (standard) : sinon il croit encore devoir répondre.
    notify.sync_stand_in(delegation.delegate.user)
    Notification.objects.create(recipient=delegation.delegate.user, employee=delegation.delegator,
                                kind=Notification.Kind.DELEGATION_ENDED)
    return delegation
