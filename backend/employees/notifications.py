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


def refresh_for(user):
    """Met à jour les notifications de ce RH (appelé quand il ouvre la cloche).

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


def message(notification):
    """Le texte affiché, calculé aujourd'hui : "... se termine le 15/11/2026 (dans 9 jours)."."""
    employee = notification.employee
    name = f"{employee.first_name} {employee.last_name}"
    Kind = Notification.Kind

    # Les demandes (app workflows, step 7).
    if notification.kind != Kind.TRIAL_END:
        title = notification.request.title
        if notification.kind == Kind.TO_VALIDATE:
            return f"{name} attend votre réponse : {title}."
        if notification.kind == Kind.INFORMED:
            return f"Pour information : {title} ({name})."
        if notification.kind == Kind.APPROVED:
            return f"Votre demande a été acceptée : {title}."
        # Refusée : avec le motif (le commentaire est obligatoire pour refuser).
        rejected = notification.request.steps.filter(status="REJECTED").first()
        reason = f" Motif : {rejected.comment}" if rejected and rejected.comment else ""
        return f"Votre demande a été refusée : {title}.{reason}"

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
