"""Les notifications de la cloche 🔔 (step G) : la fin de la période d'essai approche.
(Les notifications des demandes sont créées par le moteur : voir workflows/notify.py.)

Règle (validée avec les RH) : les RH sont prévenus 10 jours avant la fin de la période d'essai,
et 1 mois avant pour un cadre. La notification reste tant que le statut est "Période d'essai"
(même après la date : il faut confirmer l'embauche ou mettre fin au contrat).

Qui est prévenu : les RH du pôle du collaborateur, et les Admin RH (les deux pôles).
"""
import calendar
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import F
from django.utils import timezone

from .models import Employee, Notification
from .services import limited_to_own_pole, user_pole

NOTICE_DAYS = 10    # 10 jours avant la fin de la période d'essai...
CADRE = "Cadre"     # ... et 1 mois avant pour la catégorie "Cadre"


def one_month_before(day):
    """15/03 -> 15/02 ; 31/03 -> 28/02 (ou 29) : le même jour du mois d'avant, s'il existe."""
    year, month = (day.year - 1, 12) if day.month == 1 else (day.year, day.month - 1)
    last_day = calendar.monthrange(year, month)[1]
    return day.replace(year=year, month=month, day=min(day.day, last_day))


def notify_from(employee):
    """Le premier jour où les RH sont prévenus pour ce collaborateur."""
    if employee.category.name.lower() == CADRE.lower():
        return one_month_before(employee.trial_end_date)
    return employee.trial_end_date - timedelta(days=NOTICE_DAYS)


def receives_notifications(user):
    Role = get_user_model().Role
    return user.role in (Role.HR, Role.HR_ADMIN)


def employees_to_watch(user):
    """Les collaborateurs en période d'essai, visibles par ce RH, dont la fin approche (ou est passée)."""
    today = timezone.localdate()
    queryset = Employee.objects.filter(
        status=Employee.Status.TRIAL,
        trial_end_date__isnull=False,
        trial_end_date__lte=today + timedelta(days=31),  # au plus tôt : 1 mois avant (cadres)
    ).select_related("category")
    # Un RH ne voit que son pôle (sans dossier, donc sans pôle : rien). Admin RH : les deux.
    if limited_to_own_pole(user):
        pole = user_pole(user)
        if pole is None:
            return []
        queryset = queryset.filter(department__direction__entity__pole=pole.pk)
    return [employee for employee in queryset if notify_from(employee) <= today]


# P3 (rappels) : les autres modules ajoutent ICI leurs rappels "calculés à l'ouverture de la cloche"
# (pas de programme qui tourne chaque nuit), comme la fin de période d'essai. Ex. le module Congés :
# "des jours seront perdus le 31/12" ; le moteur des demandes : "une demande t'attend depuis 3 jours".
BELL_REFRESHERS = []


def on_bell_refresh(refresher):
    """Pour un module : @on_bell_refresh sur une fonction (user) qui crée / enlève ses rappels."""
    BELL_REFRESHERS.append(refresher)
    return refresher


def refresh_for(user):
    """Met à jour les notifications de cette personne (appelé quand elle ouvre la cloche) :
    la fin de période d'essai (les RH), puis les rappels des autres modules (tout le monde)."""
    refresh_trial(user)
    for refresher in BELL_REFRESHERS:
        refresher(user)


# Les travaux "une fois par jour" des modules (2026-11-12), faits au début du tour du matin, avant les rappels.
# Ex. le module Congés : annuler les demandes pas validées avant leur premier jour (leaves/handlers.py).
MORNING_JOBS = []


def on_morning_round(job):
    """Pour un module : @on_morning_round sur une fonction (sans argument) faite chaque matin par le facteur."""
    MORNING_JOBS.append(job)
    return job


def refresh_everyone():
    """Le tour du matin (emails, step 4, 2026-11-12) : d'abord les travaux du jour des modules (MORNING_JOBS),
    puis refresh_for pour TOUS les comptes actifs, comme si chacun ouvrait sa cloche. Sans ce tour, un rappel
    (31/12, demande en attente, fin d'essai) naissait seulement à l'ouverture de la cloche : quelqu'un qui ne vient
    pas dans l'application n'avait pas d'email. Le refaire ne crée pas de doublon (les contraintes uniques des
    notifications). Rend (comptes vérifiés, erreurs)."""
    checked, errors = 0, []
    for job in MORNING_JOBS:
        try:
            job()
        except Exception as error:  # un travail raté n'empêche pas les rappels
            errors.append(f"{job.__name__} : {error}")
    for user in get_user_model().objects.filter(is_active=True).order_by("id"):
        try:
            refresh_for(user)
            checked += 1
        except Exception as error:  # un compte à problème n'empêche pas les autres d'avoir leurs rappels
            errors.append(f"{user.username} : {error}")
    return checked, errors


def refresh_trial(user):
    """La fin de période d'essai, pour un RH.

    1. Crée celles qui manquent. ignore_conflicts : celles qui existent déjà sont ignorées
       (la contrainte unique empêche les doublons, même avec deux onglets ouverts en même temps).
    2. Supprime celles PAS ENCORE LUES qui ne servent plus : statut changé (Actif, Sorti),
       ou date de fin changée. Celles déjà lues restent (c'est l'historique du RH).
    """
    if not receives_notifications(user):
        return
    watched = employees_to_watch(user)
    Notification.objects.bulk_create(
        [Notification(recipient=user, employee=employee, kind=Notification.Kind.TRIAL_END, due_date=employee.trial_end_date)
         for employee in watched],
        ignore_conflicts=True,
    )
    Notification.objects.filter(recipient=user, kind=Notification.Kind.TRIAL_END, read_at__isnull=True).exclude(
        employee__in=[employee.pk for employee in watched], due_date=F("employee__trial_end_date"),
    ).delete()


def link(notification):
    """La page ouverte au clic (dans la cloche ET le bouton de l'email) : la fiche, "Team approvals"
    (pour répondre), ma page Congés, ou l'historique de la demande."""
    Kind = Notification.Kind
    if notification.kind in (Kind.TRIAL_END, Kind.ACCOUNT_TO_BLOCK, Kind.ACCOUNT_BLOCKED):
        return f"/employees/{notification.employee_id}"  # la fiche (ex. la mettre en "Sorti")
    # Délégations à accepter / acceptées / refusées (2026-11-19) : là où on les voit. Un collaborateur délégué : sa page
    # "Stand-in requests" (il n'a pas Team approvals) ; les autres : la carte "Out of office" de Team approvals.
    if notification.kind in (Kind.DELEGATION_ASKED, Kind.DELEGATION_ACCEPTED, Kind.DELEGATION_DECLINED):
        collaborator = notification.recipient.role == get_user_model().Role.COLLABORATOR
        return "/stand-in" if notification.kind == Kind.DELEGATION_ASKED and collaborator else "/approvals"
    if notification.kind in (Kind.TO_VALIDATE, Kind.DELEGATED, Kind.REMINDER):
        # Un collaborateur qui répond À LA PLACE d'un absent (délégué, 2026-11-12) n'a pas "Team approvals" :
        # sa page "Stand-in requests". Mais un collaborateur peut aussi être lui-même le N+1 (responsable d'une
        # équipe sans le rôle Manager) : pour SES étapes, "Team approvals" comme les autres valideurs.
        if notification.recipient.role != get_user_model().Role.COLLABORATOR:
            return "/approvals"
        own = notification.request_id and notification.request.steps.filter(assignee__user=notification.recipient_id).exists()
        return "/approvals" if own and notification.kind != Kind.DELEGATED else "/stand-in"
    # Arrivées et départs (2026-11-23) : mes tâches -> "My tasks" ; tout est prêt (les RH) -> "Arrivals & departures".
    if notification.kind == Kind.LEAVE_PAST_LAST_DAY:
        return "/leaves"  # ma page Congés : "Cancel" sur ce congé, puis un nouveau plus court
    if notification.kind in (Kind.EXIT_INTERVIEW, Kind.DEPARTURE_RECORDED):
        return "/my-departure"  # mon départ : où il en est, le questionnaire de l'entretien de sortie
    if notification.kind in (Kind.JOURNEY_TASKS, Kind.TASK_LATE, Kind.JOURNEY_CANCELLED):
        return "/my-tasks"
    if notification.kind == Kind.JOURNEY_DONE:
        return "/onboarding"
    if not notification.request_id:
        return "/"  # (garde-fou) une notification sans demande ni page à elle : le tableau de bord
    if notification.kind in (Kind.BALANCE_ADJUSTED, Kind.RIGHT_CHANGED, Kind.EXPIRING):
        return "/leaves"  # ma page Congés : mon solde et la section "Balance changes"
    if notification.kind in (Kind.DOCUMENT_READY, Kind.ORIGINAL_READY, Kind.REQUESTED_FOR, Kind.ORIGINAL_HANDED):
        # Le collaborateur : sa page Administrative documents, la demande OUVERTE (2026-11-17 : un clic sur "Document
        # prêt" montre le document, View / Download, sans le chercher). Son manager (qui l'a saisie) : "For my team".
        if notification.employee.user_id != notification.recipient_id:
            return "/approvals?tab=team"
        return f"/documents?open={notification.request_id}"
    if notification.request.workflow.code == "EXPENSE" and notification.request.requester.user_id == notification.recipient_id:
        # MA note de frais (corrigée, acceptée, refusée, annulée) : ma page Expense claims, la note OUVERTE dans le
        # panneau (2026-11-19, demande de l'utilisatrice : voir, vérifier, télécharger le PDF, sans chercher).
        return f"/expenses?open={notification.request_id}"
    if notification.kind == Kind.DELEGATION_ENDED:
        # Ce que j'ai répondu en remplacement : My requests -> Received (collaborateur), Team approvals -> History.
        return "/requests?tab=received" if notification.recipient.role == get_user_model().Role.COLLABORATOR else "/approvals"
    # Pour information, acceptée, refusée, annulée... : l'historique de la demande, avec le bon RETOUR (?from=) :
    # ma demande -> "My requests" ; celle d'un autre -> la page où je la retrouve (2026-11-12 : un manager ouvrait
    # la demande d'un collaborateur, et "← My requests" le menait à SES demandes).
    return f"/requests/{notification.request_id}?from={back_page(notification)}"


def back_page(notification):
    """La page d'où la personne retrouve cette demande (le "← retour" de l'historique)."""
    request = notification.request
    if request.requester.user_id == notification.recipient_id:
        return "requests"  # ma propre demande
    Role = get_user_model().Role
    role = notification.recipient.role
    if role in (Role.HR, Role.HR_ADMIN):
        # Les RH suivent les congés dans Absences, les notes de frais dans Reimbursements, les documents dans
        # Document requests.
        return {"LEAVE": "absences", "EXPENSE": "reimbursements", "ADMIN_REQUEST": "document-requests", "DEPARTURE": "onboarding"}.get(
            request.workflow.code, "approvals")
    # Un valideur : Team approvals (onglet History) ; un collaborateur délégué : My requests -> Received (toujours
    # là, même la délégation finie). Un collaborateur responsable d'équipe (l'étape est la sienne) : Team approvals.
    if role != Role.COLLABORATOR or request.steps.filter(assignee__user=notification.recipient_id).exists():
        return "approvals"
    return "received"


def message(notification):
    """Le texte affiché, calculé aujourd'hui : "... se termine le 15/11/2026 (dans 9 jours)."."""
    employee = notification.employee
    name = f"{employee.first_name} {employee.last_name}"
    Kind = Notification.Kind

    # Arrivées et départs (app journeys) : le texte compte MES tâches aujourd'hui.
    if notification.kind in (Kind.JOURNEY_TASKS, Kind.TASK_LATE, Kind.JOURNEY_DONE, Kind.ACCOUNT_TO_BLOCK,
                             Kind.JOURNEY_CANCELLED, Kind.ACCOUNT_BLOCKED):
        from journeys.handlers import journey_message  # importé ici : journeys importe déjà employees
        return journey_message(notification, name)
    if notification.kind == Kind.EXIT_INTERVIEW:
        return (f"Votre départ est validé (dernier jour le {notification.due_date:%d/%m/%Y}). Avant de partir, donnez "
                "votre avis : l'entretien de sortie prend 5 minutes, et seuls les RH le lisent.")
    if notification.kind == Kind.DEPARTURE_RECORDED:
        departure = getattr(notification.request, "departure", None) if notification.request_id else None
        what = f" ({departure.get_departure_type_display()})" if departure else ""
        return (f"Votre départ est enregistré{what} : dernier jour le {notification.due_date:%d/%m/%Y}. "
                "Les RH vous contactent pour la suite.")
    # Mon congé dépasse mon dernier jour (départ validé, 2026-11-25) : à moi de décider. Calculé à l'affichage :
    # s'il est déjà annulé, on le dit.
    if notification.kind == Kind.LEAVE_PAST_LAST_DAY:
        leave = getattr(notification.request, "leave", None)
        if leave is None:
            return f"Un congé dépasse votre dernier jour ({notification.due_date:%d/%m/%Y})."
        what = f"Votre congé du {leave.start_date:%d/%m/%Y} au {leave.end_date:%d/%m/%Y}"
        if notification.request.status not in ("IN_PROGRESS", "APPROVED"):
            return f"{what} est fermé : rien à faire."
        return (f"{what} dépasse votre dernier jour ({notification.due_date:%d/%m/%Y}). Annulez-le, puis demandez "
                f"un nouveau congé jusqu'au {notification.due_date:%d/%m/%Y} si vous le souhaitez. Une question : les RH.")
    # Un congé recompté (un jour férié a changé) : le recalcul de CE moment-là (il peut y en avoir plusieurs).
    if notification.kind == Kind.RECOUNTED:
        return recount_message(notification, name)
    # Les RH ont changé MON solde (une correction, ou mon droit annuel) : le changement de CE moment-là.
    if notification.kind in (Kind.BALANCE_ADJUSTED, Kind.RIGHT_CHANGED):
        return balance_change_message(notification)
    if notification.kind == Kind.EXPIRING:
        # Le nombre est recalculé à l'affichage : s'il a pris un congé depuis, le chiffre baisse.
        from leaves.balance import balance
        from leaves.counting import days_label
        expiring = balance(employee)["expiring"]
        days = expiring["days"] if expiring else 0
        return f"{days_label(days)} jour(s) de votre solde seront perdus le {notification.due_date:%d/%m/%Y} : pensez à les prendre."
    if notification.kind == Kind.REMINDER:
        request = notification.request
        waiting = (timezone.localdate() - timezone.localtime(request.created_at).date()).days
        return f"Rappel : {name} attend votre réponse depuis {waiting} jours : {request.title}."
    if notification.kind == Kind.NOT_VALIDATED:
        # 2 jours avant le début (due_date) : le demandeur et les RH. Qui la demande attend encore.
        request = notification.request
        step = request.steps.filter(status="PENDING").select_related("assignee").first()
        who = (f"{step.assignee.first_name} {step.assignee.last_name}" if step and step.assignee_id
               else step.get_approver_display() if step else "?")
        start = notification.due_date.strftime("%d/%m/%Y")
        if employee.user_id == notification.recipient_id:
            return (f"Votre demande n'est pas encore validée (en attente de {who}) : {request.title}. "
                    f"Sans validation avant le {start}, elle sera annulée automatiquement.")
        return f"Pas encore validée (en attente de {who}) : {request.title} ({name}), qui commence le {start}."
    if notification.kind == Kind.EXPIRED:
        request = notification.request
        return f"Demande annulée automatiquement : {request.title} ({name}). Motif : {request.cancel_reason}"
    if notification.kind == Kind.DELEGATED:
        # Importé ici : l'app workflows importe déjà employees (sinon une boucle d'imports).
        from workflows.models import Delegation
        delegation = (Delegation.objects.filter(delegator=employee, delegate__user=notification.recipient_id,
                                                created_at__lte=notification.created_at).order_by("-created_at").first())
        period = f" du {delegation.start_date:%d/%m/%Y} au {delegation.end_date:%d/%m/%Y}" if delegation else ""
        return f"Vous remplacez {name}{period} : ses demandes à valider arrivent aussi chez vous."
    if notification.kind == Kind.DELEGATION_ASKED:
        from workflows.models import Delegation
        delegation = (Delegation.objects.filter(delegator=employee, delegate__user=notification.recipient_id,
                                                created_at__lte=notification.created_at).order_by("-created_at").first())
        period = f" du {delegation.start_date:%d/%m/%Y} au {delegation.end_date:%d/%m/%Y}" if delegation else ""
        return (f"{name} vous demande de le remplacer{period} : répondre à ses demandes à valider pendant son absence. "
                "Acceptez ou refusez.")
    if notification.kind in (Kind.DELEGATION_ACCEPTED, Kind.DELEGATION_DECLINED):
        # `employee` = le délégué qui a répondu. Pour l'absent : "vous" ; pour le RH qui l'avait saisie : son nom.
        from workflows.models import Delegation
        from workflows.serializers import person
        delegation = (Delegation.objects.filter(delegate=employee, answered_at__lte=notification.created_at)
                      .select_related("delegator").order_by("-answered_at").first())
        if delegation is None:
            return f"{name} a répondu à la délégation."
        mine = delegation.delegator.user_id == notification.recipient_id
        replace = "vous remplacer" if mine else f"remplacer {person(delegation.delegator)}"
        period = f"du {delegation.start_date:%d/%m/%Y} au {delegation.end_date:%d/%m/%Y}"
        if notification.kind == Kind.DELEGATION_ACCEPTED:
            return f"{name} a accepté de {replace} {period}."
        return (f"{name} a refusé de {replace} {period}. Motif : {delegation.decline_reason} "
                "Choisissez une autre personne (« Out of office »).")
    # Pour le collaborateur lui-même, ou pour celui qui a saisi sa demande (son manager, 2026-11-16) : pas "Votre ...".
    for_me = employee.user_id == notification.recipient_id
    if notification.kind == Kind.DOCUMENT_READY:
        document = document_of(notification, "delivered_at")  # documents.DocumentRequest : CELUI qui vient d'être livré
        what = f"{document.doc_type} (réf. {document.reference})" if document else notification.request.title
        if not for_me:
            return f"Le document de {name} est prêt : {what}. Il le télécharge dans son espace « Administrative documents »."
        return f"Votre document est prêt : {what}. Téléchargez-le dans « Administrative documents »."
    if notification.kind == Kind.REQUESTED_FOR:
        from workflows.serializers import name_of
        all_documents = list(notification.request.documents.select_related("doc_type"))  # un ou plusieurs (2026-11-17)
        if not all_documents:
            return f"Une demande a été faite pour vous : {notification.request.title}."
        document = all_documents[0]
        who = name_of(document.requested_by) if document.requested_by_id else "Votre manager"
        names = " + ".join(str(item.doc_type) for item in all_documents)
        return (f"{who} a demandé pour vous : {names} ({document.get_format_display().lower()}). "
                "Les RH la préparent ; vous serez prévenu quand elle sera prête.")
    if notification.kind == Kind.ORIGINAL_HANDED:
        from workflows.serializers import name_of, person
        document = document_of(notification, "collected_at")
        if document is None or document.handed_to is None:
            return f"Votre original a été remis à votre manager : {notification.request.title}."
        by = f" par {name_of(document.collected_by)}" if document.collected_by_id else ""
        return (f"L'original de votre {document.doc_type} a été remis à votre manager {person(document.handed_to)}"
                f"{by}, le {timezone.localtime(document.collected_at):%d/%m/%Y}.")
    if notification.kind == Kind.ORIGINAL_READY:
        document = document_of(notification, "original_ready_at")
        what = document.doc_type if document else notification.request.title
        if not for_me:
            return f"L'original signé de {name} attend au bureau RH : {what}. Prévenez-le de passer le récupérer."
        return f"L'original signé de votre document vous attend au bureau RH : {what}. Passez le récupérer."
    if notification.kind == Kind.EXPENSE_CORRECTED:
        return expense_correction_message(notification)
    if notification.kind == Kind.DELEGATION_ENDED:
        from workflows.models import Delegation
        delegation = (Delegation.objects.filter(delegator=employee, delegate__user=notification.recipient_id,
                                                ended_at__isnull=False).order_by("-ended_at").first())
        period = f" (prévue du {delegation.start_date:%d/%m/%Y} au {delegation.end_date:%d/%m/%Y})" if delegation else ""
        return f"La délégation de {name}{period} est terminée : vous ne répondez plus à sa place."
    if notification.kind == Kind.ANSWERED_FOR:
        # Mon délégué a répondu à ma place : qui, validé ou refusé, et son commentaire.
        from workflows.serializers import name_of
        request = notification.request
        step = (request.steps.filter(on_behalf_of__user=notification.recipient_id)
                .select_related("decided_by").order_by("-decided_at").first())
        if step is None:
            return f"Votre délégué a répondu en votre nom : {request.title} ({name})."
        verb = "validé" if step.status == "APPROVED" else "refusé"
        comment = f" Commentaire : {step.comment}" if step.comment else ""
        return f"{name_of(step.decided_by)} a {verb} en votre nom : {request.title} ({name}).{comment}"

    # Les demandes (app workflows, step 7).
    if notification.kind != Kind.TRIAL_END:
        title = notification.request.title
        if notification.kind == Kind.CANCELLED:
            from workflows.serializers import name_of
            request = notification.request
            reason = f" Motif : {request.cancel_reason}" if request.cancel_reason else ""
            # Personne n'a cliqué (2026-11-25, engine.cancel_for par l'application, ex. un congé après le dernier
            # jour d'un départ) : "annulée automatiquement", le motif dit pourquoi.
            if not request.cancelled_by:
                return f"Demande annulée automatiquement : {title} ({name}).{reason}"
            who = name_of(request.cancelled_by)  # "Manager Test", pas "manager.test"
            return f"Demande annulée par {who} : {title} ({name}).{reason}"
        if notification.kind == Kind.TO_VALIDATE:
            return f"{name} attend votre réponse : {title}."
        if notification.kind == Kind.INFORMED:
            return f"Pour information : {title} ({name})."
        whose = "Votre demande" if for_me else f"La demande de {name}"  # le manager qui l'a saisie pour lui
        if notification.kind == Kind.APPROVED:
            return f"{whose} a été acceptée : {title}."
        # Refusée : avec le motif (le commentaire est obligatoire pour refuser).
        rejected = notification.request.steps.filter(status="REJECTED").first()
        reason = f" Motif : {rejected.comment}" if rejected and rejected.comment else ""
        return f"{whose} a été refusée : {title}.{reason}"

    # La fin de la période d'essai (step G).
    end = notification.due_date.strftime("%d/%m/%Y")
    days = (notification.due_date - timezone.localdate()).days
    if days > 1:
        return f"La période d'essai de {name} se termine le {end} (dans {days} jours)."
    if days == 1:
        return f"La période d'essai de {name} se termine demain ({end})."
    if days == 0:
        return f"La période d'essai de {name} se termine aujourd'hui."
    return f"La période d'essai de {name} s'est terminée le {end} : confirmez l'embauche ou mettez fin au contrat."


def balance_change_message(notification):
    """Ex. "Votre solde de congé a été corrigé : -2,5 j au 31/12/2025. Motif : Congés 2025 (Excel)." ;
    "Votre droit annuel est de 30 j à partir du 01/09/2026. Motif : Promotion."."""
    # Importé ici : l'app leaves importe déjà employees (sinon une boucle d'imports).
    from leaves.counting import days_label
    from leaves.models import AnnualRightChange, BalanceAdjustment

    # Le changement qui a créé CETTE notification : le dernier enregistré avant elle, pour ce collaborateur.
    if notification.kind == Notification.Kind.BALANCE_ADJUSTED:
        item = (BalanceAdjustment.objects.filter(employee=notification.employee, created_at__lte=notification.created_at)
                .order_by("-created_at", "-id").first())
        if item is None:
            return "Votre solde de congé a été corrigé par les RH."
        sign = "+" if item.days > 0 else "-"
        return f"Votre solde de congé a été corrigé : {sign}{days_label(abs(item.days))} j au {item.date:%d/%m/%Y}. Motif : {item.reason}."
    item = (AnnualRightChange.objects.filter(employee=notification.employee, created_at__lte=notification.created_at)
            .order_by("-created_at", "-id").first())
    if item is None:
        return "Votre droit annuel de congé a été modifié par les RH."
    return f"Votre droit annuel est de {days_label(item.annual_days)} j à partir du {item.effective_from:%d/%m/%Y}. Motif : {item.reason}."


def document_of(notification, moment):
    """Le document dont parle CETTE notification (2026-11-17 : une demande peut avoir plusieurs documents, prêts à des
    moments différents) : le dernier dont `moment` (delivered_at, original_ready_at, collected_at) est passé avant elle ;
    sinon le premier de la demande. None : une demande sans document."""
    documents = notification.request.documents.select_related("doc_type", "handed_to")
    return (documents.filter(**{f"{moment}__lte": notification.created_at}).order_by(f"-{moment}", "-id").first()
            or documents.order_by("id").first())


def expense_correction_message(notification):
    """Ex. "Nadia Rh (RH) a corrigé une dépense de votre note « Mission Agadir » : Hébergement du 14/11/2026,
    600,00 -> 400,00 MAD. Motif : Le reçu indique 400 MAD."."""
    # Importé ici : l'app expenses importe déjà employees (sinon une boucle d'imports).
    from expenses.models import ExpenseCorrection
    from expenses.services import money
    from workflows.serializers import name_of

    # La correction qui a créé CETTE notification : la dernière enregistrée avant elle, sur cette note.
    item = (ExpenseCorrection.objects.filter(line__claim__request=notification.request_id, corrected_at__lte=notification.created_at)
            .select_related("line__category", "line__claim", "corrected_by").order_by("-corrected_at", "-id").first())
    if item is None:
        return f"Une dépense de votre note de frais a été corrigée : {notification.request.title}."
    who = name_of(item.corrected_by) if item.corrected_by else "Un valideur"
    line = item.line
    return (f"{who} ({item.as_role}) a corrigé une dépense de votre note « {line.claim.title} » : {line.category} du "
            f"{line.date:%d/%m/%Y}, {money(item.old_amount)} -> {money(item.new_amount)} MAD. Motif : {item.reason}")


def recount_message(notification, name):
    """Ex. pour le collaborateur : "Votre congé a été recalculé : 4 -> 3 j (Aïd Al Fitr déplacé : ...)." ;
    pour les RH : "Congé de Sara Alami recalculé : 4 -> 5 j. À vérifier : Solde négatif : -1 j."."""
    # Importé ici : l'app leaves importe déjà employees (sinon une boucle d'imports).
    from leaves.counting import days_label
    from leaves.models import LeaveRecount

    # Le recalcul qui a créé CETTE notification : le dernier enregistré avant elle.
    recount = (LeaveRecount.objects.filter(leave__request=notification.request_id, created_at__lte=notification.created_at)
               .order_by("-created_at", "-id").first())
    if recount is None:
        return f"Congé recalculé : {notification.request.title}."
    change = f"{days_label(recount.old_days)} -> {days_label(recount.new_days)} j ({recount.reason})"
    if notification.recipient_id == notification.employee.user_id:
        return f"Votre congé a été recalculé : {change}."
    # Les RH ne sont prévenus que s'il y a un point à vérifier (recount.notify).
    return f"Congé de {name} recalculé : {change}." + (f" À vérifier : {recount.warning}" if recount.warning else "")
