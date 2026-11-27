"""Le PRÉAVIS d'un départ (2026-11-25) : une seule place pour la règle (le formulaire, la carte de validation, le
panneau des RH et, plus tard, le solde de tout compte lisent tous ce fichier).

La loi (Code du travail, art. 43 ; décret n° 2-04-469 du 29/12/2004) : celui qui rompt le contrat (le salarié qui
démissionne, l'employeur qui licencie) respecte un délai. Il dépend du groupe et de l'ancienneté :
                         moins d'1 an   1 à 5 ans   plus de 5 ans
  Cadres et assimilés      1 mois        2 mois       3 mois
  Employés et ouvriers     8 jours       1 mois       2 mois
C'est le MINIMUM : le contrat ou la convention collective peuvent donner plus -> Admin RH change la grille.
Préavis non respecté : celui qui ne l'a pas respecté paie l'indemnité (art. 51), calculée par la PAIE (l'application
ne connaît pas les salaires : elle donne les jours manquants).

Le préavis court à partir du lendemain de la demande (la lettre) : début 25/11 + 1 mois = dernier jour au plus tôt
le 25/12. Les RH peuvent corriger le début (ex. la lettre est arrivée plus tôt) et décident du statut.
"""
import calendar
from datetime import timedelta

from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from .models import JourneySettings, NoticeGroup, NoticeRule, NoticeStatus, NoticeUnit


def add_months(day, months):
    """25/11 + 1 mois = 25/12 ; 31/01 + 1 mois = 28/02 (le dernier jour du mois si le jour n'existe pas)."""
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return day.replace(year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1]))


def seniority_years(employee, on):
    """Les années COMPLÈTES depuis la date d'embauche (embauché le 10/03/2023 : 2 ans le 25/11/2026)."""
    hire = employee.seniority_start  # une réembauche peut garder les années d'avant (2026-11-27)
    years = on.year - hire.year - ((on.month, on.day) < (hire.month, hire.day))
    return max(0, years)


def compute(employee, departure_type, start):
    """Le préavis de CE départ, ou None (pas de préavis pour ce type, ou pas de ligne dans la grille).
    Ex. {"group": "OTHER", "years": 3, "amount": 1, "unit": "MONTHS", "start": 25/11, "until": 25/12}."""
    current = JourneySettings.load()
    if departure_type not in (current.notice_types or []):
        return None
    executive = current.executive_categories.filter(pk=employee.category_id).exists()
    group = NoticeGroup.EXECUTIVE if executive else NoticeGroup.OTHER
    years = seniority_years(employee, start)
    rule = NoticeRule.objects.filter(group=group, min_years__lte=years).order_by("-min_years").first()
    if rule is None:
        return None
    until = add_months(start, rule.amount) if rule.unit == NoticeUnit.MONTHS else start + timedelta(days=rule.amount)
    return {"group": group, "years": years, "amount": rule.amount, "unit": rule.unit, "start": start, "until": until}


def apply(departure, start=None):
    """Prend la PHOTO du préavis sur la demande (sans l'enregistrer) et propose un statut :
    pas de préavis -> "Pas de préavis" ; dernier jour après la fin du préavis -> "Respecté" ; sinon vide (à décider)."""
    # Licenciement pour FAUTE GRAVE (art. 39) : pas de préavis (ni d'indemnité).
    serious = departure.departure_type == "DISMISSAL" and departure.serious_misconduct
    result = None if serious else compute(departure.employee, departure.departure_type, start or timezone.localdate())
    if result is None:
        departure.notice_group, departure.notice_years, departure.notice_amount, departure.notice_unit = "", None, None, ""
        departure.notice_start = departure.notice_until = None
        departure.notice_status = NoticeStatus.NONE
        return departure
    departure.notice_group, departure.notice_years = result["group"], result["years"]
    departure.notice_amount, departure.notice_unit = result["amount"], result["unit"]
    departure.notice_start, departure.notice_until = result["start"], result["until"]
    departure.notice_status = NoticeStatus.RESPECTED if departure.last_day >= result["until"] else ""
    return departure


def decide(departure, user, status, start=None):
    """Les RH du pôle décident (et peuvent corriger le début du préavis). Ex. le salarié part 10 jours plus tôt avec
    l'accord de l'employeur -> "Dispensé par l'employeur" ; sans accord -> "Non respecté" (la paie retient l'indemnité)."""
    from .services import is_hr_of  # importé ici : services importe ce fichier

    if not is_hr_of(user, departure.employee):
        raise PermissionDenied("Seuls les RH de son pôle décident du préavis.")
    if status not in NoticeStatus.values:
        raise ValidationError({"status": "Choisissez le statut du préavis."})
    if start is not None:
        if start > departure.last_day:
            raise ValidationError({"start": "Le début du préavis est après le dernier jour."})
        apply(departure, start)
    if departure.notice_until is None and status != NoticeStatus.NONE:
        raise ValidationError({"status": "Pas de préavis pour ce type de départ (Réglages des arrivées et départs)."})
    departure.notice_status = status
    departure.notice_decided_by, departure.notice_decided_at = user, timezone.now()
    departure.save()
    return departure
