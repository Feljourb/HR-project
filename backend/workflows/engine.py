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

from . import notify
from .models import Delegation, Request, RequestStep, Workflow, WorkflowStep

Approver = WorkflowStep.Approver
Mode = WorkflowStep.Mode
Status = RequestStep.Status


def still_here(employee):
    """Un collaborateur "Sorti" ne valide plus : c'est comme s'il n'y avait personne."""
    return employee if employee is not None and employee.status != Employee.Status.LEFT else None


def hr_validators(requester):
    """Les comptes qui répondent à une étape "RH du pôle" pour ce demandeur :
    - les RH du pôle du demandeur ;
    - les Admin RH (une Admin RH est une RH des DEUX pôles, avec plus de droits) ;
    jamais le demandeur lui-même (personne ne valide sa propre demande).
    is_active : un compte bloqué (collaborateur "Sorti") ne valide plus."""
    Role = get_user_model().Role
    return (
        get_user_model().objects.filter(is_active=True)
        .filter(Q(role=Role.HR, employee__department__direction__entity__pole=requester.pole) | Q(role=Role.HR_ADMIN))
        .exclude(pk=requester.user_id)
    )


def find_validator(approver, requester):
    """QUI valide cette étape pour ce demandeur.
    Renvoie les champs à mettre dans l'étape (ex. {"assignee": youssef}), ou None s'il n'y a personne."""
    # N+1 / N+2 : lus dans l'organigramme (responsables), ou l'exception choisie dans la fiche.
    if approver == Approver.MANAGER:
        manager = still_here(requester.n_plus_1)
        return {"assignee": manager} if manager else None
    if approver == Approver.MANAGER_2:
        n_plus_2 = still_here(requester.n_plus_2)
        return {"assignee": n_plus_2} if n_plus_2 else None
    if approver == Approver.DG:
        # Le DG est un collaborateur (dossier RH) ; pas le demandeur lui-même (le DG qui demande un congé).
        director = still_here(requester.pole.director)
        return {"assignee": director} if director and director.pk != requester.pk else None
    # RH du pôle : pas une personne précise ({} = champs vides), mais il faut qu'il en existe au moins un.
    return {} if hr_validators(requester).exists() else None


def people_of(step):
    """Les comptes concernés par cette étape (ceux qui répondent, ou qu'on informe) : pour la cloche.
    P2 step 1 : + ceux qui répondent À LA PLACE d'un valideur absent (son délégué, son responsable, ou les RH)."""
    requester = step.request.requester
    if step.assignee_id:
        people = [step.assignee.user]  # N+1, N+2 ou DG
        kind, stand = stand_in(step)
        if kind == "person":
            people.append(stand.user)
        elif kind == "hr":
            people += list(hr_validators(requester))
        return list(dict.fromkeys(people))
    return list(hr_validators(requester))  # RH du pôle + Admin RH


# --- P2 step 1 : un valideur absent (délégation, puis son responsable, puis les RH) ---------------

# Les modules disent au moteur "cette personne est absente ce jour-là" (ex. le module Congés : un congé
# accepté). Le moteur ne sait rien des congés : il demande seulement aux fonctions de cette liste.
ABSENCE_CHECKS = []


def on_absence_check(check):
    """Pour un module : @on_absence_check sur une fonction (employee, day) -> True si absent ce jour-là."""
    ABSENCE_CHECKS.append(check)
    return check


def is_absent(employee, day=None):
    day = day or timezone.localdate()
    return any(check(employee, day) for check in ABSENCE_CHECKS)


def delegate_of(employee, day=None):
    """Le délégué choisi pour cette personne ce jour-là (Délégation en cours), ou None."""
    day = day or timezone.localdate()
    delegation = (Delegation.objects.filter(delegator=employee, ended_at__isnull=True, start_date__lte=day, end_date__gte=day)
                  .select_related("delegate__user").first())
    return still_here(delegation.delegate) if delegation else None


def stand_in(step):
    """QUI répond À LA PLACE de la personne attendue par cette étape (N+1, N+2 ou DG), aujourd'hui.
    Le standard des logiciels RH, en 3 niveaux (décision du 2026-11-09) :
    1. elle a choisi un délégué pour ces dates            -> ("person", le délégué) ;
    2. sinon, elle est absente (en congé accepté aujourd'hui) -> ("person", SON responsable),
       sauf si ce responsable est le DG du pôle (il ne connaît pas le travail de chaque équipe), absent lui aussi,
       ou s'il n'y en a pas                              -> ("hr", None) : les RH du pôle (le filet de sécurité) ;
    3. sinon (présente, pas de délégué)                  -> (None, None) : personne ne la remplace.
    Jamais le demandeur lui-même (personne ne valide sa propre demande)."""
    if not step.assignee_id:
        return None, None
    requester = step.request.requester
    delegate = delegate_of(step.assignee)
    if delegate and delegate.pk != requester.pk:
        return "person", delegate
    if not is_absent(step.assignee):
        return None, None
    above = still_here(step.assignee.n_plus_1)
    director = requester.pole.director
    if above and above.pk != requester.pk and (director is None or above.pk != director.pk) and not is_absent(above):
        return "person", above
    return "hr", None


def answers_for_absent(user, step):
    """True si CET utilisateur répond à la place de la personne absente (voir stand_in)."""
    kind, stand = stand_in(step)
    if kind == "person":
        return stand.user_id == user.pk
    if kind == "hr":
        return hr_validators(step.request.requester).filter(pk=user.pk).exists()
    return False


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
    # On ajoute donc à la fin une étape "RH du pôle valide" (les RH du pôle et les Admin RH).
    if not any(step.mode == Mode.VALIDATE and step.status != Status.SKIPPED for step in steps):
        last = max((step.order for step in steps), default=0)
        steps.append(RequestStep(request=request, order=last + 1, approver=Approver.HR, mode=Mode.VALIDATE))

    RequestStep.objects.bulk_create(steps)

    # 3. On avance jusqu'à la première étape qui attend une réponse.
    advance(request)
    return request


@transaction.atomic
def record_approved(code, requester, title, user, comment):
    """Une demande enregistrée par les RH À LA PLACE du demandeur, déjà ACCEPTÉE (standard des logiciels RH :
    les RH sont l'autorité). Ex. un congé maladie passé que le collaborateur n'a pas pu demander lui-même.
    Pas de circuit à suivre (personne n'est sonné pour valider) : une seule étape "RH du pôle", validée par CE RH,
    avec son commentaire : l'historique dit qui l'a fait et quand. Le demandeur est prévenu (🔔 acceptée).
    Le module (celui qui appelle) vérifie avant que ce RH en a le droit."""
    workflow = Workflow.objects.get(code=code)
    if not workflow.is_active:
        raise ValidationError("Ce type de demande est désactivé.")
    now = timezone.now()
    request = Request.objects.create(workflow=workflow, requester=requester, title=title,
                                     status=Request.Status.APPROVED, closed_at=now)
    RequestStep.objects.create(request=request, order=1, approver=Approver.HR, mode=Mode.VALIDATE,
                               status=Status.APPROVED, decided_by=user, decided_at=now, comment=comment)
    notify.send([requester.user], notify.Kind.APPROVED, request)  # 🔔 au demandeur
    handler = HANDLERS.get(code)
    if handler:
        handler(request)
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
            notify.send(people_of(step), notify.Kind.INFORMED, request)  # 🔔 "Pour information"
            continue
        step.status = Status.PENDING
        step.save(update_fields=["status"])
        notify.send(people_of(step), notify.Kind.TO_VALIDATE, request)   # 🔔 "Demande à valider"
        return
    request.status, request.closed_at = Request.Status.APPROVED, now
    request.save(update_fields=["status", "closed_at"])
    notify.send([request.requester.user], notify.Kind.APPROVED, request)  # 🔔 au demandeur
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
    # N+1 / N+2 / DG : la personne trouvée à l'envoi, ou celle qui la remplace si elle est absente (P2 step 1).
    if step.assignee_id:
        return step.assignee.user_id == user.pk or answers_for_absent(user, step)
    # RH du pôle : un RH du pôle du demandeur, ou une Admin RH ; jamais le demandeur lui-même.
    return hr_validators(step.request.requester).filter(pk=user.pk).exists()


def steps_waiting_for(user):
    """Les étapes qui attendent la réponse de CET utilisateur (sa page "Team approvals").
    La même règle que can_decide, mais pour toutes les étapes d'un coup (une seule requête SQL)."""
    Role = get_user_model().Role
    mine = Q(assignee__user=user)  # N+1 / N+2 : c'est moi qu'on attend
    pole = user_pole(user)
    if user.role == Role.HR and pole is not None:
        # RH : les étapes "RH du pôle" des demandes de MON pôle.
        mine |= Q(approver=Approver.HR, request__requester__department__direction__entity__pole=pole)
    if user.role == Role.HR_ADMIN:
        # Admin RH : une RH des deux pôles -> toutes les étapes "RH du pôle".
        mine |= Q(approver=Approver.HR)
    waiting = (RequestStep.objects.filter(status=Status.PENDING, request__status=Request.Status.IN_PROGRESS)
               .exclude(request__requester__user=user))  # jamais ma propre demande
    ids = set(waiting.filter(mine).values_list("pk", flat=True))
    # P2 step 1 : + les étapes d'un valideur absent que JE remplace (délégué, responsable, ou RH).
    # Vérifiées une par une (la règle dépend des congés du jour) : il y a peu d'étapes en attente à la fois.
    others = waiting.filter(assignee__isnull=False).exclude(assignee__user=user).exclude(pk__in=ids)
    for step in others.select_related("assignee", "request__requester__department__direction__entity__pole"):
        if answers_for_absent(user, step):
            ids.add(step.pk)
    return RequestStep.objects.filter(pk__in=ids)


def requests_visible_to(user):
    """Les demandes dont CET utilisateur peut lire l'historique (step 8) : celles qui le concernent.
    - le demandeur ; ceux qu'une étape attend ou a attendus (N+1, N+2), ceux qui ont répondu ;
    - les RH : les demandes de leur pôle ; Admin RH et IT : toutes.
    distinct() : une demande liée deux fois (ex. N+1 ET a répondu) ne revient qu'une fois."""
    Role = get_user_model().Role
    if user.is_superuser or user.role == Role.HR_ADMIN:
        return Request.objects.all()
    mine = Q(requester__user=user) | Q(steps__assignee__user=user) | Q(steps__decided_by=user)
    pole = user_pole(user)
    if user.role == Role.HR and pole is not None:
        mine |= Q(requester__department__direction__entity__pole=pole)
    # P2 step 1 : celui qui remplace un absent ouvre aussi l'historique des demandes qu'il doit traiter.
    mine |= Q(pk__in=steps_waiting_for(user).values("request"))
    return Request.objects.filter(mine).distinct()


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
    # P2 step 1 : quelqu'un d'autre que la personne attendue a répondu (elle était absente) : on le note.
    if step.assignee_id and step.assignee.user_id != user.pk:
        step.on_behalf_of = step.assignee
    step.save(update_fields=["status", "decided_by", "decided_at", "comment", "on_behalf_of"])
    # 🔔 L'étape a sa réponse : les autres (ex. les autres RH du pôle) n'ont plus à la valider.
    notify.clear_waiting(step.request)


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
    notify.send([request.requester.user], notify.Kind.REJECTED, request)  # 🔔 au demandeur (avec le motif)
    return request


@transaction.atomic
def cancel(request, user):
    """Le demandeur annule sa demande, tant qu'elle est en cours."""
    request = Request.objects.select_for_update().get(pk=request.pk)
    if request.requester.user_id != user.pk:
        raise PermissionDenied("Seul le demandeur peut annuler sa demande.")
    if request.status != Request.Status.IN_PROGRESS:
        raise ValidationError("Cette demande est déjà terminée.")
    request.status, request.closed_at, request.cancelled_by = Request.Status.CANCELLED, timezone.now(), user
    request.save(update_fields=["status", "closed_at", "cancelled_by"])
    notify.clear_waiting(request)  # 🔔 plus rien à valider : les "Demande à valider" pas lues partent
    return request


@transaction.atomic
def cancel_approved(request, user, reason):
    """Annule une demande DÉJÀ ACCEPTÉE (ex. un congé qui n'a pas encore commencé), avec un motif obligatoire.
    Le moteur ne sait pas QUI peut ni QUAND : le module le vérifie avant (Congés : le demandeur ou les RH du pôle,
    avant le premier jour). Prévenus (🔔 "Demande annulée") : ceux qui l'avaient validée, et le demandeur si
    quelqu'un d'autre annule pour lui."""
    request = Request.objects.select_for_update().select_related("requester").get(pk=request.pk)
    if request.status != Request.Status.APPROVED:
        raise ValidationError("Seule une demande acceptée peut être annulée ici.")
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("Un motif est obligatoire pour annuler une demande acceptée.")
    request.status, request.closed_at = Request.Status.CANCELLED, timezone.now()
    request.cancelled_by, request.cancel_reason = user, reason
    request.save(update_fields=["status", "closed_at", "cancelled_by", "cancel_reason"])
    deciders = get_user_model().objects.filter(pk__in=request.steps.exclude(decided_by=None).values("decided_by"))
    people = [*deciders, *([request.requester.user] if request.requester.user_id != user.pk else [])]
    notify.send([person for person in dict.fromkeys(people) if person.pk != user.pk], notify.Kind.CANCELLED, request)
    return request
