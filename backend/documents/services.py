"""Documents administratifs : demander un document, le générer, le déposer (RH).

Comme les congés et les notes de frais : le module vérifie SES règles, puis donne la demande au moteur
(engine.submit("ADMIN_REQUEST") : les RH du pôle valident). Après la validation (handlers.py) :
- type avec un modèle : le PDF est généré tout de suite (generate) ;
- sinon : les RH du pôle déposent le PDF signé (upload).
Dans les deux cas, le collaborateur reçoit 🔔 + email "Document prêt".
"""
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from employees.models import Employee, Notification
from leaves.holidays import ensure_years
from leaves.models import PublicHoliday
from workflows import engine
from workflows.models import Request, Workflow
from workflows.serializers import person

from .models import MAX_FILE_SIZE, DocumentRequest
from .pdf import TEMPLATES


def add_working_days(start, days):
    """start + N jours OUVRÉS (lundi -> vendredi, sans les jours fériés actifs). Ex. jeudi + 2 = lundi."""
    ensure_years(start, start + timedelta(days=days * 2 + 14))  # les jours fériés de ces années existent
    holidays = set(PublicHoliday.objects.filter(is_active=True, date__gt=start,
                                                date__lte=start + timedelta(days=days * 2 + 14)).values_list("date", flat=True))
    day = start
    while days > 0:
        day += timedelta(days=1)
        if day.weekday() < 5 and day not in holidays:
            days -= 1
    return day


FORMAT_IN_TITLE = {DocumentRequest.Format.ORIGINAL: "original", DocumentRequest.Format.BOTH: "PDF + original"}


@transaction.atomic
def request_document(employee, doc_type, purpose="", by=None, format=DocumentRequest.Format.PDF):
    """Demander un document. Une règle refusée -> ValidationError({"doc_type": [...]}).
    format : PDF, ORIGINAL (papier signé à la main, à récupérer au bureau RH) ou BOTH.
    - par le collaborateur lui-même (by vide, ou lui) : la demande suit le circuit (les RH du pôle valident) ;
    - par un RH POUR un collaborateur (champ "Employé (RH)", standard "request on behalf of") : les RH sont
      l'autorité, la demande est ACCEPTÉE tout de suite (engine.record_approved, l'historique dit qui l'a faite)."""
    for_other = by is not None and by.pk != employee.user_id
    if for_other and not can_prepare(by, DocumentRequest(employee=employee)):
        raise PermissionDenied("Seuls les RH du pôle du collaborateur demandent un document pour lui.")
    # Deux clics "Envoyer" en même temps : le second attend le premier, puis voit la demande déjà en cours.
    Employee.objects.select_for_update().get(pk=employee.pk)
    if not doc_type.is_active:
        raise ValidationError({"doc_type": ["Ce document n'est plus proposé."]})
    if format not in DocumentRequest.Format.values:
        raise ValidationError({"format": ["Choisissez le format : PDF, original ou les deux."]})
    # Une seule demande en cours par type (standard) : à valider, ou validée et pas encore préparée par les RH.
    waiting = Q(request__status=Request.Status.IN_PROGRESS) | DocumentRequest.to_prepare_filter()
    if DocumentRequest.objects.filter(waiting, employee=employee, doc_type=doc_type).exists():
        raise ValidationError({"doc_type": ["Une demande est déjà en cours pour ce document."]})

    purpose = (purpose or "").strip()[:200]
    # Le titre (Team approvals, l'historique, la cloche) dit tout de suite au RH s'il faut un original papier :
    # "Attestation de travail (Banque) · original".
    title = f"{doc_type.name} ({purpose})" if purpose else doc_type.name
    if format in FORMAT_IN_TITLE:
        title = f"{title} · {FORMAT_IN_TITLE[format]}"
    title = title[:200]  # la longueur maximum d'un titre de demande (un motif très long)
    if for_other:
        request = engine.record_approved(Workflow.Code.ADMIN_REQUEST, employee, title, by,
                                         f"Demandé par les RH pour {person(employee)}.")
    else:
        request = engine.submit(Workflow.Code.ADMIN_REQUEST, employee, title)
    document = DocumentRequest.objects.create(
        request=request, employee=employee, doc_type=doc_type, purpose=purpose, format=format,
        requested_by=by if for_other else None,
        due_date=add_working_days(timezone.localdate(), 0 if doc_type.template else doc_type.delivery_days))
    # Déjà acceptée (demandée par les RH) : le handler est passé AVANT que le document existe -> on génère ici.
    if request.status == Request.Status.APPROVED and doc_type.template:
        generate(document)
    return document


def deliver(document, content, name, user=None):
    """Range le fichier, donne la référence, et prévient le collaborateur (🔔 + email "Document prêt").
    Format "original" seul : le PDF sert aux RH à l'IMPRIMER (le collaborateur veut le papier) : pas de "Document
    prêt" ; il sera prévenu quand l'original l'attendra au bureau RH (mark_original_ready)."""
    if not document.reference:
        document.reference = f"DOC-{timezone.localdate():%Y}-{document.pk:05d}"  # unique : le numéro de la demande
    document.file.save(name, content, save=False)
    document.file_name = name[:200]
    document.delivered_at, document.delivered_by = timezone.now(), user
    document.save(update_fields=["reference", "file", "file_name", "delivered_at", "delivered_by"])
    if document.needs_pdf:
        Notification.objects.create(recipient=document.employee.user, employee=document.employee,
                                    kind=Notification.Kind.DOCUMENT_READY, request=document.request)
    return document


def generate(document):
    """Le type a un modèle : l'application fabrique le PDF (ex. l'attestation de travail)."""
    if not document.reference:
        # La référence est écrite DANS le PDF : on la donne avant de le fabriquer.
        document.reference = f"DOC-{timezone.localdate():%Y}-{document.pk:05d}"
    content = TEMPLATES[document.doc_type.template](document)
    name = f"{document.doc_type.name} - {document.employee.last_name} {document.employee.first_name}.pdf"
    return deliver(document, ContentFile(content), name)


def can_prepare(user, document):
    """Qui dépose le document : les RH du pôle du collaborateur et les Admin RH (jamais pour soi-même), et l'IT."""
    return user.is_superuser or engine.hr_validators(document.employee).filter(pk=user.pk).exists()


@transaction.atomic
def upload(document, user, file):
    """Un RH dépose le PDF signé d'une demande VALIDÉE (ou le remplace, ex. une erreur). Le collaborateur est prévenu."""
    document = DocumentRequest.objects.select_for_update().select_related("request", "employee__user").get(pk=document.pk)
    if not can_prepare(user, document):
        raise PermissionDenied("Seuls les RH du pôle du collaborateur déposent ce document.")
    if document.request.status != Request.Status.APPROVED:
        raise ValidationError("Le document se dépose après la validation de la demande.")
    if not document.needs_pdf:
        raise ValidationError("Le collaborateur a demandé l'original papier seulement : pas de PDF à déposer.")
    if file is None:
        raise ValidationError("Choisissez le fichier PDF.")
    if Path(file.name).suffix.lower() != ".pdf":
        raise ValidationError("Seulement un PDF (le document signé, scanné).")
    if file.size > MAX_FILE_SIZE:
        raise ValidationError("Le document dépasse 5 Mo.")
    return deliver(document, file, file.name, user)


def original_to_handle(document, user):
    """Relit la demande verrouillée et vérifie qu'un RH peut s'occuper de son ORIGINAL papier."""
    document = DocumentRequest.objects.select_for_update().select_related("request", "employee__user").get(pk=document.pk)
    if not can_prepare(user, document):
        raise PermissionDenied("Seuls les RH du pôle du collaborateur s'occupent de l'original.")
    if not document.needs_original:
        raise ValidationError("Le collaborateur n'a pas demandé l'original papier.")
    if document.request.status != Request.Status.APPROVED:
        raise ValidationError("L'original se prépare après la validation de la demande.")
    return document


@transaction.atomic
def mark_original_ready(document, user):
    """Le RH a imprimé, signé et tamponné l'original : il attend au bureau RH. Le collaborateur est prévenu
    (🔔 + email "Original prêt au bureau RH") : il ne se déplace pas pour rien."""
    document = original_to_handle(document, user)
    if document.original_ready_at:
        raise ValidationError("L'original est déjà prêt.")
    document.original_ready_at, document.original_ready_by = timezone.now(), user
    document.save(update_fields=["original_ready_at", "original_ready_by"])
    Notification.objects.create(recipient=document.employee.user, employee=document.employee,
                                kind=Notification.Kind.ORIGINAL_READY, request=document.request)
    return document


@transaction.atomic
def mark_handed_over(document, user):
    """Le collaborateur est venu : l'original lui est remis (en main propre). La trace : quand, et par quel RH."""
    document = original_to_handle(document, user)
    if not document.original_ready_at:
        raise ValidationError("Marquez d'abord l'original comme prêt.")
    if document.collected_at:
        raise ValidationError("L'original est déjà remis.")
    document.collected_at, document.collected_by = timezone.now(), user
    document.save(update_fields=["collected_at", "collected_by"])
    return document
