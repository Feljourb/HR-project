"""
Le moteur des circuits. Step 4 : ENVOYER une demande (submit).

submit() fait 3 choses :
  1. crée la demande ;
  2. copie les étapes du circuit (la "photo") et trouve QUI valide chaque étape ;
  3. avance jusqu'à la première étape qui attend une réponse (advance).

Les modules (Congé, Note de frais...) appellent seulement submit(code, demandeur, titre) :
ils n'ont pas besoin de savoir comment le circuit fonctionne.
"""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from employees.models import Employee

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
