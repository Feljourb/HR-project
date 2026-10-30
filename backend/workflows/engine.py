"""
Le moteur des circuits.

Step 4 : ENVOYER une demande (submit). submit() fait 3 choses :
  1. crée la demande ;
  2. copie les étapes du circuit (la "photo") et trouve QUI valide chaque étape ;
  3. avance jusqu'à la première étape qui attend une réponse (advance).

Step 5 : DÉCIDER. approve() / reject() par le valideur, cancel() par le demandeur.
Quand la demande est acceptée, le moteur appelle le module (voir on_approved).

Les modules (Congé, Note de frais...) appellent seulement ces fonctions :
ils n'ont pas besoin de savoir comment le circuit fonctionne.
"""
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from employees.models import Employee
from employees.services import user_pole

from .models import Request, RequestStep, Workflow, WorkflowStep

Approver = WorkflowStep.Approver
Mode = WorkflowStep.Mode
Status = RequestStep.Status


def still_here(employee):
    """Un collaborateur "Sorti" ne valide plus : c'est comme s'il n'y avait personne."""
    return employee if employee is not None and employee.status != Employee.Status.LEFT else None


def hr_of_pole(pole, requester):
    """Les RH du pôle qui peuvent valider une demande : jamais le demandeur lui-même
    (règle : personne ne valide sa propre demande)."""
    return (
        Employee.objects.filter(user__role=get_user_model().Role.HR, department__direction__entity__pole=pole)
        .exclude(status=Employee.Status.LEFT)
        .exclude(pk=requester.pk)
    )


def find_validator(approver, requester):
    """QUI valide cette étape pour ce demandeur.
    Renvoie les champs à mettre dans l'étape (ex. {"assignee": youssef}), ou None s'il n'y a personne."""
    if approver == Approver.MANAGER:
        manager = still_here(requester.manager)
        return {"assignee": manager} if manager else None
    if approver == Approver.MANAGER_2:
        n_plus_2 = still_here(requester.n_plus_2)
        return {"assignee": n_plus_2} if n_plus_2 else None
    if approver == Approver.DG:
        director = requester.pole.director
        return {"director": director} if director and director.is_active else None
    # RH du pôle : pas une personne précise ({} = champs vides), mais il faut qu'il en existe au moins un.
    return {} if hr_of_pole(requester.pole, requester).exists() else None


@transaction.atomic
def submit(code, requester, title):
    """Envoie une demande dans son circuit. Ex. submit("LEAVE", sara, "Congé du 10 au 15 novembre").
    transaction.atomic : si quelque chose échoue au milieu, rien n'est enregistré (pas de demande à moitié)."""
    workflow = Workflow.objects.get(code=code)
    if not workflow.is_active:
        raise ValidationError("Ce type de demande est désactivé.")

    request = Request.objects.create(workflow=workflow, requester=requester, title=title)
    now = timezone.now()

    # 2. La photo du circuit : une étape de demande par étape du circuit, avec QUI valide.
    steps = []
    for step in workflow.steps.all():
        validator = find_validator(step.approver, requester)
        if validator is None:
            # Personne à ce poste (ex. pas de N+2) : l'étape est sautée tout de suite, et on en garde la trace.
            steps.append(RequestStep(request=request, order=step.order, approver=step.approver, mode=step.mode,
                                     status=Status.SKIPPED, decided_at=now))
        else:
            steps.append(RequestStep(request=request, order=step.order, approver=step.approver, mode=step.mode, **validator))

    # Règle : si toutes les étapes "Valider" sont sautées, personne ne vérifierait la demande.
    # On ajoute donc à la fin une étape "RH du pôle valide".
    if not any(step.mode == Mode.VALIDATE and step.status != Status.SKIPPED for step in steps):
        last = max((step.order for step in steps), default=0)
        steps.append(RequestStep(request=request, order=last + 1, approver=Approver.HR, mode=Mode.VALIDATE))

    RequestStep.objects.bulk_create(steps)

    # 3. On avance jusqu'à la première étape qui attend une réponse.
    advance(request)
    return request


def advance(request):
    """Passe aux étapes suivantes, dans l'ordre :
    - "Informer" : marquée "informée", et on continue (elle n'attend personne) ;
    - "Valider" : elle devient "à traiter", et on s'arrête : la demande attend sa réponse ;
    - plus aucune étape : la demande est acceptée.
    (Step 5 l'appellera aussi après chaque validation.)"""
    now = timezone.now()
    for step in request.steps.filter(status=Status.WAITING):  # dans l'ordre 1, 2, 3 (Meta.ordering)
        if step.mode == Mode.INFORM:
            step.status, step.decided_at = Status.INFORMED, now
            step.save(update_fields=["status", "decided_at"])
            continue
        step.status = Status.PENDING
        step.save(update_fields=["status"])
        return
    request.status, request.closed_at = Request.Status.APPROVED, now
    request.save(update_fields=["status", "closed_at"])
    # La demande est acceptée : le module fait son travail (ex. Congé : retirer les jours du solde).
    handler = HANDLERS.get(request.workflow.code)
    if handler:
        handler(request)


# --- Passer la main au module (step 5) ---------------------------------------------

# code du circuit -> la fonction du module à appeler quand une demande est acceptée.
HANDLERS = {}


def on_approved(code):
    """Pour un module : "appelle cette fonction quand une demande de ce type est acceptée".
    Exemple, dans le futur module Congé :

        @on_approved("LEAVE")
        def retirer_les_jours(request):
            ...
    """
    def register(function):
        HANDLERS[code] = function
        return function
    return register


# --- Décider (step 5) -----------------------------------------------------------------

def can_decide(user, step):
    """Est-ce que CET utilisateur peut répondre à CETTE étape ?"""
    if step.status != Status.PENDING or step.request.status != Request.Status.IN_PROGRESS:
        return False
    # N+1 / N+2 : seulement la personne trouvée à l'envoi.
    if step.assignee_id:
        return step.assignee.user_id == user.pk
    # DG : il n'a pas encore de compte (step 6). Personne ne peut répondre à sa place.
    if step.director_id:
        return False
    # RH du pôle : n'importe quel RH du pôle du demandeur, sauf le demandeur lui-même.
    requester = step.request.requester
    return hr_of_pole(requester.pole, requester).filter(user=user).exists()


def steps_waiting_for(user):
    """Les étapes qui attendent la réponse de CET utilisateur (sa page "Team approvals").
    La même règle que can_decide, mais pour toutes les étapes d'un coup (une seule requête SQL)."""
    mine = Q(assignee__user=user)  # N+1 / N+2 : c'est moi qu'on attend
    pole = user_pole(user)
    if user.role == get_user_model().Role.HR and pole is not None:
        # RH : les étapes "RH du pôle" des demandes de MON pôle.
        mine |= Q(approver=Approver.HR, request__requester__department__direction__entity__pole=pole)
    return (
        RequestStep.objects.filter(mine, status=Status.PENDING, request__status=Request.Status.IN_PROGRESS)
        .exclude(request__requester__user=user)  # jamais ma propre demande
    )


def pending_step(step):
    """Relit l'étape en la VERROUILLANT jusqu'à la fin de la transaction (select_for_update) :
    si deux RH cliquent "Valider" en même temps, le second attend, puis voit qu'elle est déjà traitée."""
    step = RequestStep.objects.select_for_update().select_related("request__workflow").get(pk=step.pk)
    if step.status != Status.PENDING or step.request.status != Request.Status.IN_PROGRESS:
        raise ValidationError("Cette étape n'attend plus de réponse.")
    return step


def decide(step, user, status, comment):
    """Enregistre la réponse sur l'étape : qui, quand, quoi, et le commentaire (l'historique)."""
    if not can_decide(user, step):
        raise PermissionDenied("Vous ne pouvez pas répondre à cette étape.")
    step.status, step.decided_by, step.decided_at, step.comment = status, user, timezone.now(), comment.strip()
    step.save(update_fields=["status", "decided_by", "decided_at", "comment"])


@transaction.atomic
def approve(step, user, comment=""):
    """Le valideur accepte (commentaire facultatif), puis la demande continue son circuit."""
    step = pending_step(step)
    decide(step, user, Status.APPROVED, comment)
    advance(step.request)
    return step.request


@transaction.atomic
def reject(step, user, comment):
    """Le valideur refuse : un commentaire est obligatoire, et la demande s'arrête là
    (les étapes suivantes ne seront jamais atteintes)."""
    if not comment.strip():
        raise ValidationError("Un commentaire est obligatoire pour refuser.")
    step = pending_step(step)
    decide(step, user, Status.REJECTED, comment)
    request = step.request
    request.status, request.closed_at = Request.Status.REJECTED, step.decided_at
    request.save(update_fields=["status", "closed_at"])
    return request


@transaction.atomic
def cancel(request, user):
    """Le demandeur annule sa demande, tant qu'elle est en cours."""
    request = Request.objects.select_for_update().get(pk=request.pk)
    if request.requester.user_id != user.pk:
        raise PermissionDenied("Seul le demandeur peut annuler sa demande.")
    if request.status != Request.Status.IN_PROGRESS:
        raise ValidationError("Cette demande est déjà terminée.")
    request.status, request.closed_at = Request.Status.CANCELLED, timezone.now()
    request.save(update_fields=["status", "closed_at"])
    return request
