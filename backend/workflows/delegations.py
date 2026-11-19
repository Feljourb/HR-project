"""P2 step 1 : les délégations ("absent du bureau") d'un valideur.

Ex. Youssef part du 10 au 20/11 : "mes demandes vont aussi à Karim". Pendant la période, Karim les voit dans
"Team approvals" et y répond À LA PLACE de Youssef (l'historique dit "pour Youssef"). Le moteur s'en sert dans
engine.stand_in.
2026-11-19 (remarque de la réunion) : si Admin RH le demande (WorkflowSettings.delegate_must_accept, coché par
défaut), Karim doit d'abord ACCEPTER (il peut être en congé, ou ne pas vouloir) ; tant qu'il n'a pas accepté, rien
ne lui arrive. S'il refuse (avec un motif), Youssef est prévenu et choisit quelqu'un d'autre.
"""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from employees.models import Notification

from . import engine, notify
from .models import Delegation, RequestStep, WorkflowSettings


def can_manage(user, delegator):
    """Qui choisit le délégué de quelqu'un : la personne elle-même, ou les RH de son pôle / Admin RH (ex. une absence
    soudaine : elle ne peut pas le faire), et l'IT (support)."""
    return (user.is_superuser or delegator.user_id == user.pk
            or engine.hr_validators(delegator).filter(pk=user.pk).exists())


def send_waiting(delegation):
    """La délégation vaut (acceptée) et la période a commencé : 🔔 "Demande à valider" au délégué pour chaque
    demande qui attendait DÉJÀ l'absent (standard : il couvre tout ce qui attend pendant la période)."""
    if delegation.start_date > timezone.localdate():
        return  # prévue plus tard : le tour du matin le fera le premier jour (notify.sync_stand_in)
    delegate = delegation.delegate
    waiting = RequestStep.objects.filter(assignee=delegation.delegator, status=RequestStep.Status.PENDING).select_related("request")
    for step in waiting:
        if step.request.requester_id != delegate.pk:
            Notification.objects.create(recipient=delegate.user, employee=step.request.requester,
                                        kind=Notification.Kind.TO_VALIDATE, request=step.request)


@transaction.atomic
def create_delegation(delegator, delegate, start_date, end_date, user):
    if not can_manage(user, delegator):
        raise PermissionDenied("Seuls la personne elle-même et les RH de son pôle choisissent son délégué.")
    must_accept = WorkflowSettings.load().delegate_must_accept
    delegation = Delegation(delegator=delegator, delegate=delegate, start_date=start_date, end_date=end_date, created_by=user,
                            answer=Delegation.Answer.WAITING if must_accept else Delegation.Answer.ACCEPTED)
    delegation.full_clean()
    delegation.save()
    if must_accept:
        # 🔔 + email au délégué : "Youssef vous demande de le remplacer... Acceptez ou refusez."
        Notification.objects.create(recipient=delegate.user, employee=delegator, kind=Notification.Kind.DELEGATION_ASKED)
        return delegation
    # Sans acceptation (réglage décoché) : comme avant, la délégation vaut tout de suite.
    Notification.objects.create(recipient=delegate.user, employee=delegator, kind=Notification.Kind.DELEGATED)
    send_waiting(delegation)
    return delegation


def tell_absent(delegation, kind):
    """La réponse du délégué : 🔔 à l'absent, et au RH qui a saisi la délégation pour lui (s'il y en a un)."""
    people = {delegation.delegator.user_id}
    if delegation.created_by_id and delegation.created_by_id != delegation.delegate.user_id:
        people.add(delegation.created_by_id)
    Notification.objects.bulk_create(Notification(recipient_id=user_id, employee=delegation.delegate, kind=kind)
                                     for user_id in people)


def check_answer(delegation, user):
    """Seul le délégué répond, une seule fois, et tant que la période n'est pas finie."""
    if delegation.delegate.user_id != user.pk:
        raise PermissionDenied("Seule la personne choisie comme délégué répond à cette demande.")
    if delegation.answer != Delegation.Answer.WAITING:
        raise ValidationError("Vous avez déjà répondu à cette délégation.")
    if delegation.ended_at or delegation.end_date < timezone.localdate():
        raise ValidationError("Cette délégation est déjà terminée.")


@transaction.atomic
def accept_delegation(delegation, user):
    delegation = Delegation.objects.select_for_update().select_related("delegator__user", "delegate__user").get(pk=delegation.pk)
    check_answer(delegation, user)
    delegation.answer, delegation.answered_at = Delegation.Answer.ACCEPTED, timezone.now()
    delegation.save(update_fields=["answer", "answered_at"])
    tell_absent(delegation, Notification.Kind.DELEGATION_ACCEPTED)
    send_waiting(delegation)  # ce qui attendait déjà l'absent arrive chez le délégué
    return delegation


@transaction.atomic
def decline_delegation(delegation, user, reason):
    delegation = Delegation.objects.select_for_update().select_related("delegator__user", "delegate__user").get(pk=delegation.pk)
    check_answer(delegation, user)
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError({"reason": ["Donnez le motif du refus (ex. « Je suis en congé à ces dates »)."]})
    delegation.answer, delegation.answered_at, delegation.decline_reason = Delegation.Answer.DECLINED, timezone.now(), reason[:300]
    delegation.save(update_fields=["answer", "answered_at", "decline_reason"])
    tell_absent(delegation, Notification.Kind.DELEGATION_DECLINED)
    return delegation


def end_delegation(delegation, user):
    """"End now" : la délégation s'arrête tout de suite (elle reste dans l'historique). Aussi une délégation encore
    en attente de réponse (l'absent change d'avis)."""
    if not can_manage(user, delegation.delegator):
        raise PermissionDenied("Seuls la personne elle-même et les RH de son pôle terminent cette délégation.")
    if delegation.ended_at or delegation.end_date < timezone.localdate() or delegation.answer == Delegation.Answer.DECLINED:
        raise ValidationError("Cette délégation est déjà terminée.")
    delegation.ended_at = timezone.now()
    delegation.save(update_fields=["ended_at"])
    # 🔔 Ce qui attendait l'absent quitte tout de suite la cloche du délégué (pas encore lu),
    # et le délégué est prévenu (standard) : sinon il croit encore devoir répondre.
    notify.sync_stand_in(delegation.delegate.user)
    Notification.objects.create(recipient=delegation.delegate.user, employee=delegation.delegator,
                                kind=Notification.Kind.DELEGATION_ENDED)
    return delegation
