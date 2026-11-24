"""Les règles des arrivées et départs : commencer un parcours, faire une tâche, annuler.
Les vues (views.py) ne font qu'appeler ces fonctions : une seule place pour chaque règle."""
import os
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from employees import history
from employees.models import Employee, Notification
from employees.services import sees_both_poles, user_pole

from .models import Departure, DepartureType, Journey, JourneySettings, JourneyTask, Kind, Owner, TaskTemplate

# Une fiche créée avec une date d'embauche plus ancienne (ex. les RH saisissent les collaborateurs déjà là) :
# pas d'arrivée automatique (personne ne prépare un PC pour quelqu'un qui est là depuis 3 ans).
AUTO_START_DAYS_BACK = 7


def is_hr(user):
    Role = get_user_model().Role
    return user.is_superuser or user.role in (Role.HR, Role.HR_ADMIN)


def is_hr_of(user, employee):
    """Les RH de son pôle, Admin RH (les deux pôles) et l'IT gèrent le parcours de ce collaborateur."""
    if not is_hr(user):
        return False
    if sees_both_poles(user):
        return True
    pole = user_pole(user)
    return pole is not None and pole.pk == employee.pole.pk


def hr_people(employee):
    """Les comptes qui font les tâches "RH du pôle" : les RH de son pôle + les Admin RH (comme le moteur des demandes).
    Jamais la personne elle-même (une RH qui arrive ne prépare pas son propre contrat)."""
    Role = get_user_model().Role
    return (get_user_model().objects.filter(is_active=True)
            .filter(Q(role=Role.HR, employee__department__direction__entity__pole=employee.pole) | Q(role=Role.HR_ADMIN))
            .exclude(pk=employee.user_id))


def visible_journeys(user):
    """Les parcours qu'un RH suit : son pôle (Admin RH et IT : les deux)."""
    queryset = Journey.objects.select_related("employee__department__direction__entity__pole", "employee__position")
    if sees_both_poles(user):
        return queryset
    if not is_hr(user):
        # Un manager (ou un chef d'équipe) : les arrivées et départs de SON équipe (il coche seulement ses tâches).
        return queryset.filter(employee__in=[member.pk for member in team_of(user)])
    pole = user_pole(user)
    return queryset.filter(employee__department__direction__entity__pole=pole.pk) if pole else queryset.none()


def team_of(user):
    """Les personnes dont ce compte est le N+1 (la même règle que les validations et le Team calendar)."""
    from leaves.views import my_team  # importé ici : un seul endroit pour la règle "mon équipe"
    return my_team(Employee.objects.filter(user=user).select_related("department__direction__entity__pole").first())


def tasks_of(user):
    """MES tâches : celles où je suis la personne, + (un RH) les tâches "RH du pôle" de mon pôle.
    Jamais celles d'un parcours annulé."""
    mine = Q(person__user=user)
    if is_hr(user) and not user.is_superuser:
        mine |= Q(owner=Owner.HR, journey__in=visible_journeys(user))
    return (JourneyTask.objects.filter(mine, journey__cancelled_at__isnull=True)
            .select_related("journey__employee__department__direction", "journey__employee__position", "person", "done_by"))


def can_handle(user, task):
    """Qui peut cocher "Fait" : la personne de la tâche ; les RH du pôle (ils coordonnent, ils peuvent tout cocher) ; l'IT."""
    if user.is_superuser or is_hr_of(user, task.journey.employee):
        return True
    return task.person_id is not None and task.person.user_id == user.pk


def who_does(owner, person, employee):
    """La vraie personne d'une tâche, lue AUJOURD'HUI : (owner, person). Pas de manager, ou personne choisie sortie :
    la tâche va aux RH du pôle (personne n'est oublié)."""
    if owner == Owner.MANAGER:
        manager = employee.n_plus_1
        return (Owner.MANAGER, manager) if manager is not None else (Owner.HR, None)
    if owner == Owner.PERSON:
        if person is not None and person.status != Employee.Status.LEFT:
            return Owner.PERSON, person
        return Owner.HR, None
    if owner == Owner.EMPLOYEE:
        return Owner.EMPLOYEE, employee
    return Owner.HR, None


def recipients(journey):
    """Les comptes qui ont au moins une tâche dans ce parcours (pour la cloche)."""
    users = {task.person.user_id for task in journey.tasks.select_related("person") if task.person_id and task.person.user_id}
    if journey.tasks.filter(owner=Owner.HR).exists():
        users |= set(hr_people(journey.employee).values_list("pk", flat=True))
    return users


def notify(journey):
    """🔔 + email "Tâches à faire" à chaque personne qui a une tâche (une seule notification par personne et par
    parcours : le texte compte SES tâches)."""
    Notification.objects.bulk_create(
        [Notification(recipient_id=user_id, employee=journey.employee, kind=Notification.Kind.JOURNEY_TASKS, due_date=journey.day)
         for user_id in recipients(journey)],
        ignore_conflicts=True,
    )


@transaction.atomic
def start(employee, kind, user, day=None):
    """Commence le parcours d'arrivée de ce collaborateur (les RH) : copie le modèle, prévient chacun.
    (Un départ commence par une DEMANDE de départ, voir request_departure.)"""
    if not is_hr_of(user, employee):
        raise PermissionDenied("Seuls les RH de son pôle commencent ce parcours.")
    if kind != Kind.ARRIVAL:
        raise ValidationError("Un départ commence par une demande de départ (« New departure »).")
    if employee.status == Employee.Status.LEFT:
        raise ValidationError("Ce collaborateur est sorti.")
    if not TaskTemplate.objects.filter(kind=kind, is_active=True).exists():
        raise ValidationError("Aucune tâche dans le modèle : Admin RH les ajoute dans Reference lists → Arrivées et départs.")
    return create_journey(employee, kind, employee.hire_date, user)  # l'arrivée suit TOUJOURS la date d'embauche


def create_journey(employee, kind, day, user):
    """Le parcours lui-même (sans vérifier les droits : l'appelant l'a fait) : la copie du modèle, la cloche."""
    employee = Employee.objects.select_for_update().get(pk=employee.pk)  # deux clics en même temps : un seul parcours
    if Journey.objects.filter(employee=employee, kind=kind, cancelled_at__isnull=True).exists():
        raise ValidationError(f"Un parcours « {Kind(kind).label} » existe déjà pour ce collaborateur.")
    templates = list(TaskTemplate.objects.filter(kind=kind, is_active=True).select_related("person"))
    journey = Journey.objects.create(kind=kind, employee=employee, day=day, created_by=user)
    tasks = []
    for template in templates:
        owner, person = who_does(template.owner, template.person, employee)
        tasks.append(JourneyTask(journey=journey, name=template.name, owner=owner, person=person,
                                 offset_days=template.offset_days, due_date=day + timedelta(days=template.offset_days),
                                 detail_label=template.detail_label))
    JourneyTask.objects.bulk_create(tasks)
    notify(journey)
    return journey


def auto_start(employee, user):
    """Une NOUVELLE fiche (créée par les RH) : son arrivée commence toute seule, si elle arrive bientôt
    (date d'embauche pas plus de 7 jours dans le passé) et que le modèle a des tâches."""
    if employee.hire_date < timezone.localdate() - timedelta(days=AUTO_START_DAYS_BACK):
        return None
    if not TaskTemplate.objects.filter(kind=Kind.ARRIVAL, is_active=True).exists() or not is_hr_of(user, employee):
        return None
    return start(employee, Kind.ARRIVAL, user)


@transaction.atomic
def hire_date_changed(employee):
    """La date d'embauche a changé sur la fiche : l'arrivée en cours bouge avec elle (les tâches pas encore faites
    aussi, et les notifications pas encore lues). Les tâches déjà faites gardent leur date."""
    journey = Journey.objects.filter(employee=employee, kind=Kind.ARRIVAL, cancelled_at__isnull=True).first()
    if journey is None or journey.day == employee.hire_date:
        return
    old_day, journey.day = journey.day, employee.hire_date
    journey.save(update_fields=["day"])
    for task in journey.tasks.filter(done_at__isnull=True):
        task.due_date = journey.day + timedelta(days=task.offset_days)
        task.save(update_fields=["due_date"])
    Notification.objects.filter(employee=employee, kind=Notification.Kind.JOURNEY_TASKS, due_date=old_day,
                                read_at__isnull=True).update(due_date=journey.day)


@transaction.atomic
def complete(task, user, detail="", comment=""):
    """Coche "Fait" (avec l'information à noter et un commentaire, optionnels). La dernière tâche faite :
    les RH du pôle sont prévenus que tout est prêt."""
    # of=("self",) : verrouille seulement la tâche (PostgreSQL refuse de verrouiller la personne, qui peut être vide).
    task = JourneyTask.objects.select_for_update(of=("self",)).select_related("journey__employee", "person").get(pk=task.pk)
    if not can_handle(user, task):
        raise PermissionDenied("Cette tâche n'est pas la vôtre.")
    if task.journey.cancelled_at:
        raise ValidationError("Ce parcours est annulé.")
    if task.done_at:
        raise ValidationError("Cette tâche est déjà faite.")
    task.detail, task.comment = detail.strip()[:200], comment.strip()[:500]
    task.done_at, task.done_by = timezone.now(), user
    task.save(update_fields=["detail", "comment", "done_at", "done_by"])
    # Plus de retard pour cette personne si c'était sa dernière tâche en retard (le rappel non lu part).
    if not task.journey.tasks.filter(done_at__isnull=True).exists():
        Notification.objects.bulk_create(
            [Notification(recipient=hr, employee=task.journey.employee, kind=Notification.Kind.JOURNEY_DONE, due_date=task.journey.day)
             for hr in hr_people(task.journey.employee)],
            ignore_conflicts=True,
        )
    return task


@transaction.atomic
def reopen(task, user):
    """Une erreur ("Fait" coché trop tôt) : la tâche redevient à faire. La trace "fait par" est enlevée."""
    task = JourneyTask.objects.select_for_update(of=("self",)).select_related("journey__employee", "person").get(pk=task.pk)
    if not can_handle(user, task):
        raise PermissionDenied("Cette tâche n'est pas la vôtre.")
    if task.journey.cancelled_at:
        raise ValidationError("Ce parcours est annulé.")
    if not task.done_at:
        raise ValidationError("Cette tâche n'est pas encore faite.")
    task.detail, task.comment, task.done_at, task.done_by = "", "", None, None
    task.save(update_fields=["detail", "comment", "done_at", "done_by"])
    # "Tout est prêt" n'est plus vrai : la notification pas encore lue part.
    Notification.objects.filter(employee=task.journey.employee, kind=Notification.Kind.JOURNEY_DONE,
                                due_date=task.journey.day, read_at__isnull=True).delete()
    return task


@transaction.atomic
def cancel(journey, user, reason):
    """Annule un parcours (ex. la personne n'est pas venue) : motif obligatoire, rien n'est supprimé."""
    if not is_hr_of(user, journey.employee):
        raise PermissionDenied("Seuls les RH de son pôle annulent ce parcours.")
    journey = Journey.objects.select_for_update().get(pk=journey.pk)
    if journey.cancelled_at:
        raise ValidationError("Ce parcours est déjà annulé.")
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("Indiquez le motif.")
    journey.cancelled_at, journey.cancelled_by, journey.cancel_reason = timezone.now(), user, reason[:300]
    journey.save(update_fields=["cancelled_at", "cancelled_by", "cancel_reason"])
    # (2026-11-24, trouvé par l'utilisatrice) un départ annulé = sa DEMANDE aussi : "Cancelled by Admin RH" + le motif
    # dans l'historique, 🔔 au collaborateur et à ceux qui l'avaient validée, et "My departure" repropose le formulaire.
    # Avant : seules les tâches étaient annulées, la demande restait "Approved".
    departure = Departure.objects.filter(journey=journey).select_related("request").first()
    if departure is not None and departure.request.status == "APPROVED":
        from workflows import engine  # importé ici : le moteur importe déjà les modules (handlers)
        engine.cancel_approved(departure.request, user, reason)
    # Un départ annulé (ex. la personne reste finalement) : la date de sortie mise à la validation est enlevée
    # (si elle n'est pas déjà "Sorti" : là, les RH corrigent la fiche eux-mêmes).
    employee = journey.employee
    if journey.kind == Kind.DEPARTURE and employee.status != Employee.Status.LEFT and employee.departure_date == journey.day:
        before = history.snapshot(employee)
        employee.departure_date = None
        employee.save()
        history.record_changes(employee, user, before)
    # Les "tâches à faire" pas encore lues ne servent plus.
    Notification.objects.filter(employee=journey.employee, due_date=journey.day, read_at__isnull=True,
                                kind__in=[Notification.Kind.JOURNEY_TASKS, Notification.Kind.TASK_LATE]).delete()
    return journey


# --- Départ collaborateur (step 2) ----------------------------------------------------------------

LETTER_TYPES = (".pdf", ".jpg", ".jpeg", ".png")
LETTER_MAX = 5 * 1024 * 1024  # 5 Mo


def is_manager_of(user, employee):
    boss = employee.n_plus_1
    return boss is not None and boss.user_id == user.pk


def can_request_departure(user, employee):
    """Qui déclare un départ (comme NOOR) : son manager (N+1) et les RH de son pôle. Le collaborateur lui-même
    seulement si Admin RH l'autorise (Réglages, NON par défaut : "référez-vous à votre supérieur hiérarchique")."""
    if is_hr_of(user, employee) or is_manager_of(user, employee):
        return True
    return employee.user_id == user.pk and JourneySettings.load().employee_can_request_departure


def can_request_own_departure(user):
    """La page "My departure" (et son lien dans le menu) : seulement si Admin RH le permet, pour quelqu'un qui a une
    fiche et n'est pas parti. Les RH n'en ont pas besoin (ils déclarent les départs depuis "Arrivals & departures")."""
    me = Employee.objects.filter(user=user).first()
    return bool(me and me.status != Employee.Status.LEFT and not is_hr(user) and can_request_departure(user, me))


def departure_in_progress(employee):
    """Un départ en attente de validation, ou déjà validé et pas annulé."""
    return (Departure.objects.filter(employee=employee, request__status="IN_PROGRESS").exists()
            or Journey.objects.filter(employee=employee, kind=Kind.DEPARTURE, cancelled_at__isnull=True).exists())


@transaction.atomic
def request_departure(employee, user, departure_type, last_day, comment="", letter=None, informed=()):
    """Déclare le départ d'un collaborateur. Manager (ou collaborateur autorisé) : la demande part chez les RH
    (Team approvals). Les RH : acceptée tout de suite (ils sont l'autorité, comme les documents), les tâches commencent."""
    from workflows import engine  # importé ici : workflows importe déjà employees

    if not can_request_departure(user, employee):
        if employee.user_id == user.pk:
            raise PermissionDenied("Adressez-vous à votre supérieur hiérarchique pour faire cette demande.")
        raise PermissionDenied("Seuls son manager (N+1) et les RH de son pôle déclarent ce départ.")
    employee = Employee.objects.select_for_update().get(pk=employee.pk)
    if employee.status == Employee.Status.LEFT:
        raise ValidationError("Ce collaborateur est déjà sorti.")
    if departure_type not in DepartureType.values:
        raise ValidationError({"departure_type": "Choisissez le type de départ."})
    if last_day is None:
        raise ValidationError({"last_day": "Indiquez le dernier jour."})
    if last_day < employee.hire_date:
        raise ValidationError({"last_day": "Le dernier jour est avant la date d'embauche."})
    hr = is_hr_of(user, employee)
    if not hr and last_day < timezone.localdate():
        raise ValidationError({"last_day": "Le dernier jour est déjà passé : demandez aux RH."})
    if departure_in_progress(employee):
        raise ValidationError("Un départ est déjà en cours pour ce collaborateur.")
    if letter is not None:
        if os.path.splitext(letter.name)[1].lower() not in LETTER_TYPES:
            raise ValidationError({"letter": "La lettre : PDF, JPG ou PNG."})
        if letter.size > LETTER_MAX:
            raise ValidationError({"letter": "La lettre : 5 Mo au maximum."})

    title = f"Départ : {DepartureType(departure_type).label}, dernier jour le {last_day:%d/%m/%Y}"
    if hr:
        request = engine.record_approved("DEPARTURE", employee, title, user, "Départ déclaré par les RH.")
    else:
        request = engine.submit("DEPARTURE", employee, title, initiated_by=None if employee.user_id == user.pk else user)
    departure = Departure(request=request, employee=employee, departure_type=departure_type, last_day=last_day,
                          comment=(comment or "").strip()[:500])
    if letter is not None:
        departure.letter_name = os.path.basename(letter.name)[:150]
        departure.letter.save(letter.name, letter, save=False)
    departure.save()
    departure.informed.set([person for person in informed if person.pk != employee.pk])
    if hr:
        open_departure(departure, user)  # (record_approved a appelé le handler AVANT que la demande de départ existe)
    return departure


def open_departure(departure, user):
    """Le départ est validé : la date de sortie sur la fiche (le statut reste actif jusqu'au dernier jour), les tâches
    du départ (IT, RH, manager... en même temps), et la 🔔 "Pour information" aux personnes à prévenir."""
    from workflows import notify

    if departure.journey_id:
        return departure.journey  # déjà fait (jamais deux fois)
    employee = departure.employee
    before = history.snapshot(employee)
    employee.departure_date = departure.last_day
    employee.save()
    history.record_changes(employee, user, before)
    departure.journey = create_journey(employee, Kind.DEPARTURE, departure.last_day, user)
    departure.save(update_fields=["journey"])
    people = [person.user for person in departure.informed.select_related("user") if person.user_id and person.user.is_active]
    if people:
        notify.send(people, notify.Kind.INFORMED, departure.request)
    return departure.journey


def can_see_departure(user, departure):
    """La demande de départ (et sa lettre) : les RH du pôle, le manager, celui qui l'a saisie, la personne elle-même."""
    return (user.is_superuser or is_hr_of(user, departure.employee) or is_manager_of(user, departure.employee)
            or departure.employee.user_id == user.pk or departure.request.initiated_by_id == user.pk)


def close_departures(today=None):
    """Le tour du matin (chaque jour) : un départ validé dont le dernier jour est PASSÉ.
    - Réglage "automatique" (par défaut) : le collaborateur devient "Sorti" (son compte est bloqué tout seul, voir
      Employee.save) ; une ligne dans l'historique de sa fiche, par "système".
    - Réglage "à la main" : rien ne change sur la fiche ; les RH de son pôle reçoivent "Compte à bloquer" (une seule
      fois par départ ; enlevée, si pas lue, dès que la fiche est "Sorti").
    Renvoie le nombre de collaborateurs passés "Sorti" par l'app."""
    today = today or timezone.localdate()
    # Ménage : un rappel "Compte à bloquer" pas encore lu, alors que les RH l'ont déjà fait -> inutile.
    Notification.objects.filter(kind=Notification.Kind.ACCOUNT_TO_BLOCK, read_at__isnull=True,
                                employee__status=Employee.Status.LEFT).delete()
    journeys = list(Journey.objects.filter(kind=Kind.DEPARTURE, cancelled_at__isnull=True, day__lt=today)
                    .exclude(employee__status=Employee.Status.LEFT).select_related("employee__department__direction__entity__pole"))
    if not JourneySettings.load().auto_block:
        Notification.objects.bulk_create(
            [Notification(recipient=user, employee=journey.employee, kind=Notification.Kind.ACCOUNT_TO_BLOCK, due_date=journey.day)
             for journey in journeys for user in hr_people(journey.employee)],
            ignore_conflicts=True,  # déjà envoyé un autre matin : pas de doublon (contrainte unique)
        )
        return 0
    for journey in journeys:
        employee = journey.employee
        before = history.snapshot(employee)
        employee.status = Employee.Status.LEFT
        employee.departure_date = employee.departure_date or journey.day
        employee.save()
        history.record_changes(employee, None, before)
    return len(journeys)


def journey_of(notification):
    """Le parcours dont parle une notification (même collaborateur, même jour)."""
    return (Journey.objects.filter(employee=notification.employee, day=notification.due_date)
            .order_by("cancelled_at", "-id").first())
