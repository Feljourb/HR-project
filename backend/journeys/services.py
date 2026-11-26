"""Les règles des arrivées et départs : commencer un parcours, faire une tâche, annuler.
Les vues (views.py) ne font qu'appeler ces fonctions : une seule place pour chaque règle."""
import os
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from employees import history
from employees.models import Employee, Notification
from employees.services import sees_both_poles, user_pole

from . import notice
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


def recipients(journey, open_only=False):
    """Les comptes qui ont au moins une tâche dans ce parcours (pour la cloche).
    open_only : seulement ceux qui ont encore une tâche PAS faite (ex. prévenir d'une annulation)."""
    tasks = journey.tasks.filter(done_at__isnull=True) if open_only else journey.tasks.all()
    users = {task.person.user_id for task in tasks.select_related("person") if task.person_id and task.person.user_id}
    if tasks.filter(owner=Owner.HR).exists():
        users |= set(hr_people(journey.employee).values_list("pk", flat=True))
    return users


def notify(journey):
    """🔔 + email "Tâches à faire" à chaque personne qui a une tâche (une seule notification par personne et par
    parcours : le texte compte SES tâches)."""
    # Recommencé après une annulation (même jour) : "Parcours annulé" n'est plus vrai, une NOUVELLE "Tâches à faire" part.
    Notification.objects.filter(employee=journey.employee, due_date=journey.day,
                                kind=Notification.Kind.JOURNEY_CANCELLED, read_at__isnull=True).delete()
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
    # (2026-11-26, trouvé par l'utilisatrice) Ceux qui avaient encore une tâche reçoivent 🔔 + email "Parcours annulé"
    # (ex. l'IT arrête de préparer le PC), sauf celui qui annule. Leurs "Tâches à faire" / "En retard" (lues ou pas)
    # sont remplacées : un recommencement le même jour enverra une NOUVELLE "Tâches à faire" (sinon bloquée par l'ancienne).
    told = recipients(journey, open_only=True) - {user.pk}
    Notification.objects.filter(employee=journey.employee, due_date=journey.day,
                                kind__in=[Notification.Kind.JOURNEY_TASKS, Notification.Kind.TASK_LATE,
                                          Notification.Kind.JOURNEY_DONE, Notification.Kind.JOURNEY_CANCELLED]).delete()
    Notification.objects.bulk_create(
        [Notification(recipient_id=user_id, employee=journey.employee, kind=Notification.Kind.JOURNEY_CANCELLED,
                      due_date=journey.day) for user_id in told],
    )
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
    """Le FORMULAIRE "Request my departure" : seulement si Admin RH le permet, pour quelqu'un qui a une fiche et n'est
    pas parti. Les RH n'en ont pas besoin (ils déclarent les départs depuis "Arrivals & departures")."""
    me = Employee.objects.filter(user=user).first()
    return bool(me and me.status != Employee.Status.LEFT and not is_hr(user) and can_request_departure(user, me))


def shows_my_departure(user):
    """Le lien "My departure" du menu (2026-11-25) : quand je peux demander mon départ, OU quand un départ me concerne
    (déclaré par mon manager ou les RH) : je suis où il en est, et je réponds à l'entretien de sortie."""
    if can_request_own_departure(user):
        return True
    me = Employee.objects.filter(user=user).exclude(status=Employee.Status.LEFT).first()
    return bool(me and departure_in_progress(me))


def departure_in_progress(employee):
    """Un départ en attente de validation, ou déjà validé et pas annulé."""
    return (Departure.objects.filter(employee=employee, request__status="IN_PROGRESS").exists()
            or Journey.objects.filter(employee=employee, kind=Kind.DEPARTURE, cancelled_at__isnull=True).exists())


@transaction.atomic
def request_departure(employee, user, departure_type, last_day, comment="", letter=None, informed=(), serious_misconduct=False):
    """Déclare le départ d'un collaborateur. Manager (ou collaborateur autorisé) : la demande part chez les RH
    (Team approvals). Les RH : acceptée tout de suite (ils sont l'autorité, comme les documents), les tâches commencent.
    serious_misconduct : un licenciement pour faute grave (art. 39 : ni préavis, ni indemnité)."""
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
    # Une démission est un ÉCRIT (art. 34 : lettre signée, signature légalisée) : la lettre est jointe (réglage
    # d'Admin RH, OUI par défaut). Les RH reçoivent ensuite l'ORIGINAL papier (case "Original received" du panneau).
    if departure_type == DepartureType.RESIGNATION and letter is None and JourneySettings.load().letter_required:
        raise ValidationError({"letter": "Joignez la lettre de démission (écrite, signée, signature légalisée)."})
    if letter is not None:
        if os.path.splitext(letter.name)[1].lower() not in LETTER_TYPES:
            raise ValidationError({"letter": "La lettre : PDF, JPG ou PNG."})
        if letter.size > LETTER_MAX:
            raise ValidationError({"letter": "La lettre : 5 Mo au maximum."})
    serious_misconduct = bool(serious_misconduct) and departure_type == DepartureType.DISMISSAL

    title = f"Départ : {DepartureType(departure_type).label}, dernier jour le {last_day:%d/%m/%Y}"
    if hr:
        request = engine.record_approved("DEPARTURE", employee, title, user, "Départ déclaré par les RH.")
    else:
        request = engine.submit("DEPARTURE", employee, title, initiated_by=None if employee.user_id == user.pk else user)
    departure = Departure(request=request, employee=employee, departure_type=departure_type, last_day=last_day,
                          comment=(comment or "").strip()[:500], serious_misconduct=serious_misconduct)
    notice.apply(departure)  # la photo du préavis (2026-11-25) : groupe, ancienneté, durée, dernier jour au plus tôt
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
    tell_employee_recorded(departure)
    cancel_leaves_after(departure, user)
    request_exit_documents(departure, user)
    invite_exit_interview(departure)
    people = [person.user for person in departure.informed.select_related("user") if person.user_id and person.user.is_active]
    if people:
        notify.send(people, notify.Kind.INFORMED, departure.request)
    return departure.journey


def tell_employee_recorded(departure):
    """(2026-11-26, remarque de l'utilisatrice) Un départ SAISI par quelqu'un d'autre (son manager, les RH) : le moteur
    a envoyé "Demande acceptée" au collaborateur, mais il n'a rien demandé dans l'application. On la retire (même
    transaction : jamais vue, jamais envoyée par email) et, à la place :
    - licenciement : RIEN (art. 63 : la décision est remise par lettre, en main propre ; les RH l'annoncent en personne,
      l'application ne les devance pas) ;
    - les autres (démission, retraite, fin de contrat...) : 🔔 neutre "Départ enregistré".
    Son propre départ (My departure) : "Demande acceptée" reste, c'est bien sa demande."""
    employee, request = departure.employee, departure.request
    if not request.initiated_by_id or request.initiated_by_id == employee.user_id or employee.user_id is None:
        return
    Notification.objects.filter(request=request, recipient=employee.user, kind=Notification.Kind.APPROVED).delete()
    if departure.departure_type != DepartureType.DISMISSAL and employee.user.is_active:
        Notification.objects.get_or_create(recipient=employee.user, employee=employee, request=request,
                                           kind=Notification.Kind.DEPARTURE_RECORDED, due_date=departure.last_day)


def request_exit_documents(departure, user):
    """Les documents de sortie (2026-11-25), demandés TOUT SEULS à la validation, dans le module Documents, au nom de la
    RH qui a validé (comme "Employé (RH)" : acceptée tout de suite) : par défaut le certificat de travail (obligatoire,
    au plus tard 8 jours après le dernier jour, art. 72) et le reçu pour solde de tout compte (fait par la paie, art.
    73). Les RH les préparent dans "Document requests" (date limite = dernier jour + N jours, réglage).
    Rien ne bloque la validation : un document déjà en cours (ex. un certificat demandé avant) -> on ne le redemande pas."""
    from documents import services as documents
    from documents.models import DocumentRequest

    current = JourneySettings.load()
    types = list(current.exit_document_types.filter(is_active=True))
    if not types or departure.exit_request_id or user is None or not is_hr_of(user, departure.employee):
        return None
    try:
        with transaction.atomic():  # un point de retour : un refus du module Documents n'annule pas le départ
            created = documents.request_documents(departure.employee, types, purpose="Départ de l'entreprise", by=user,
                                                  format=DocumentRequest.Format.ORIGINAL)
    except (ValidationError, PermissionDenied):
        return None
    due = departure.last_day + timedelta(days=current.exit_document_days)
    DocumentRequest.objects.filter(pk__in=[document.pk for document in created]).update(due_date=due)
    # (2026-11-26, remarque de l'utilisatrice) le collaborateur n'a rien demandé : pas de 🔔 "Demande acceptée" pour ces
    # documents (même transaction : elle n'est jamais vue ni envoyée par email). Il sera prévenu quand ils sont prêts.
    Notification.objects.filter(request=created[0].request, kind=Notification.Kind.APPROVED).delete()
    departure.exit_request = created[0].request
    departure.save(update_fields=["exit_request"])
    return created


def invite_exit_interview(departure):
    """🔔 + email au collaborateur : "donnez votre avis avant de partir" (entretien de sortie, confidentiel), s'il y a
    des questions actives. Il répond dans "My departure" (ou les RH remplissent avec lui pendant l'entretien)."""
    from .models import ExitQuestion

    user_of = departure.employee.user
    if user_of is None or not user_of.is_active or not exit_interview_on() or not ExitQuestion.objects.filter(is_active=True).exists():
        return
    Notification.objects.get_or_create(recipient=user_of, employee=departure.employee,
                                       kind=Notification.Kind.EXIT_INTERVIEW, due_date=departure.last_day)


def mark_letter_original(departure, user, received):
    """Les RH du pôle : l'ORIGINAL papier de la lettre (signée, légalisée) est arrivé (ou non, une erreur)."""
    if not is_hr_of(user, departure.employee):
        raise PermissionDenied("Seuls les RH de son pôle notent la lettre originale.")
    departure.letter_original_at, departure.letter_original_by = (timezone.now(), user) if received else (None, None)
    departure.save(update_fields=["letter_original_at", "letter_original_by"])
    return departure


# --- L'entretien de sortie (confidentiel) -------------------------------------------------------------------------

def exit_interview_on():
    """L'entretien de sortie est allumé (réglage d'Admin RH, OUI par défaut)."""
    return JourneySettings.load().exit_interview_enabled


def can_see_exit_interview(user, departure):
    """Le collaborateur lui-même et les RH de son pôle (Admin RH, IT). JAMAIS le manager : il peut être la raison.
    Éteint par Admin RH : plus d'entretien, sauf ceux déjà remplis (la trace reste lisible)."""
    if not exit_interview_on() and getattr(departure, "exit_interview", None) is None:
        return False
    return departure.employee.user_id == user.pk or is_hr_of(user, departure.employee)


def exit_questions(departure):
    """Les questions à montrer : la copie déjà enregistrée (réponses passées), sinon les questions actives d'aujourd'hui."""
    from .models import ExitQuestion

    interview = getattr(departure, "exit_interview", None)
    if interview is not None and interview.questions:
        return interview.questions
    return [{"id": q.pk, "text": q.text, "kind": q.kind, "choices": q.choices, "required": q.required}
            for q in ExitQuestion.objects.filter(is_active=True)]


def can_fill_exit_interview(user, departure):
    """Qui remplit (2026-11-26, remarque de l'utilisatrice : "les RH ne changent pas les réponses du collaborateur") :
    - le collaborateur : toujours ses propres réponses ;
    - les RH : seulement si le collaborateur n'a PAS répondu lui-même (ex. un ouvrier qui n'utilise pas l'application :
      ils remplissent avec lui pendant l'entretien), ou pour corriger ce qu'ils ont eux-mêmes rempli."""
    if not exit_interview_on():
        return False  # éteint par Admin RH : on lit ce qui existe, on ne remplit plus
    if departure.employee.user_id == user.pk:
        return True
    if not is_hr_of(user, departure.employee):
        return False
    interview = getattr(departure, "exit_interview", None)
    return interview is None or interview.filled_by_id != departure.employee.user_id


def save_exit_interview(departure, user, answers):
    """Enregistre les réponses (le collaborateur, ou les RH avec lui). Une question obligatoire vide -> refusé.
    Une note : 1 à 5 ; un choix : dans la liste ; oui / non : "yes" / "no"."""
    from .models import ExitInterview, QuestionKind

    if not can_see_exit_interview(user, departure):
        raise PermissionDenied("L'entretien de sortie est confidentiel.")
    if not can_fill_exit_interview(user, departure):
        raise PermissionDenied("Le collaborateur a répondu lui-même : ses réponses ne se modifient pas.")
    if departure.request.status != "APPROVED" or (departure.journey and departure.journey.cancelled_at):
        raise ValidationError("L'entretien de sortie s'ouvre quand le départ est validé.")
    questions = exit_questions(departure)
    clean, missing = {}, []
    for question in questions:
        key = str(question["id"])
        value = answers.get(key, "") if isinstance(answers, dict) else ""
        value = str(value).strip()[:2000]
        if not value:
            if question["required"]:
                missing.append(question["text"])
            continue
        if question["kind"] == QuestionKind.RATING and value not in {"1", "2", "3", "4", "5"}:
            raise ValidationError({"answers": f"« {question['text']} » : une note de 1 à 5."})
        if question["kind"] == QuestionKind.CHOICE and value not in [str(choice) for choice in question["choices"]]:
            raise ValidationError({"answers": f"« {question['text']} » : choisissez dans la liste."})
        if question["kind"] == QuestionKind.YES_NO and value not in {"yes", "no"}:
            raise ValidationError({"answers": f"« {question['text']} » : oui ou non."})
        clean[key] = value
    if missing:
        raise ValidationError({"answers": f"Répondez à : {missing[0]}"})
    interview, _ = ExitInterview.objects.get_or_create(departure=departure, defaults={"questions": questions})
    interview.answers, interview.filled_by, interview.filled_at = clean, user, timezone.now()
    interview.save()
    return interview


def cancel_leaves_after(departure, user):
    """Le départ est validé (2026-11-25, standard Workday : le système annule et prévient) : les congés qui COMMENCENT
    après le dernier jour n'ont plus de sens (la personne ne travaille plus là). Annulés tout de suite, en cours ou
    validés, avec le motif ; les jours reviennent au solde (donc payés au départ, art. 251). 🔔 + email au collaborateur
    et à ceux qui les avaient validés (son manager). Un congé qui commence AVANT et finit APRÈS le dernier jour n'est
    pas touché : une partie est juste, les RH décident (l'avertissement du panneau)."""
    from leaves.models import LeaveRequest  # importé ici : le module Congés ne dépend pas des départs
    from workflows import engine

    reason = f"Départ de l'entreprise : dernier jour le {departure.last_day:%d/%m/%Y}. Les jours reviennent au solde."
    active = LeaveRequest.objects.filter(employee=departure.employee, request__status__in=LeaveRequest.ACTIVE).select_related("request")
    # Éteint par Admin RH (2026-11-26) : rien n'est annulé ; ces congés sont traités comme ceux à cheval (le collaborateur
    # est prévenu, les RH voient l'avertissement et décident).
    auto = JourneySettings.load().auto_cancel_leaves
    for leave in (active.filter(start_date__gt=departure.last_day) if auto else active.none()):
        # Annulé par L'APPLICATION (user None), pas par la RH qui a validé le départ (2026-11-25, remarque de
        # l'utilisatrice : "c'est l'app qui l'a fait") : la 🔔 dit "annulée automatiquement", le motif dit pourquoi.
        engine.cancel_for(leave.request, None, reason)
    # À cheval (commence avant ou le dernier jour, finit après) : le COLLABORATEUR décide (2026-11-25, idée de
    # l'utilisatrice) : 🔔 + email "Congé après le dernier jour" -> l'annuler, puis en demander un plus court.
    # Les RH gardent l'avertissement du panneau (s'il ne fait rien, ils l'annulent).
    user_of = departure.employee.user
    if user_of is not None and user_of.is_active:
        Notification.objects.bulk_create([
            Notification(recipient=user_of, employee=departure.employee, kind=Notification.Kind.LEAVE_PAST_LAST_DAY,
                         request=leave.request, due_date=departure.last_day)
            for leave in active.filter(end_date__gt=departure.last_day)  # (annulation automatique : il ne reste que ceux à cheval)
        ], ignore_conflicts=True)


def can_see_departure(user, departure):
    """La demande de départ (et sa lettre) : les RH du pôle, le manager, celui qui l'a saisie, la personne elle-même,
    + (2026-11-25) tous ceux qui lisent l'historique de la demande : un valideur du circuit (ex. le N+2 si Admin RH
    l'ajoute), le délégué d'un valideur absent. Jamais les autres (la lettre est un document personnel)."""
    if (user.is_superuser or is_hr_of(user, departure.employee) or is_manager_of(user, departure.employee)
            or departure.employee.user_id == user.pk or departure.request.initiated_by_id == user.pk):
        return True
    from workflows import engine  # importé ici : le moteur importe déjà les modules (handlers)
    return engine.requests_visible_to(user).filter(pk=departure.request_id).exists()


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
    """Le parcours dont parle une notification (même collaborateur, même jour).
    Annulé puis recommencé le même jour = deux parcours : "Parcours annulé" parle du dernier ANNULÉ, les autres
    notifications du parcours EN COURS d'abord (2026-11-26 : PostgreSQL met les vides EN DERNIER par défaut, la
    cloche parlait de l'arrivée annulée au lieu de la nouvelle)."""
    journeys = Journey.objects.filter(employee=notification.employee, day=notification.due_date)
    if notification.kind == Notification.Kind.JOURNEY_CANCELLED:
        return journeys.filter(cancelled_at__isnull=False).order_by("-cancelled_at").first()
    return journeys.order_by(F("cancelled_at").asc(nulls_first=True), "-id").first()
