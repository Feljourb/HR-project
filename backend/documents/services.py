"""Documents administratifs : demander un document, le générer, le déposer (RH).

Comme les congés et les notes de frais : le module vérifie SES règles, puis donne la demande au moteur
(engine.submit("ADMIN_REQUEST") : les RH du pôle valident). Après la validation (handlers.py) :
- type avec un modèle : le PDF est généré tout de suite (generate) ;
- sinon : les RH du pôle déposent le PDF signé (upload).
Dans les deux cas, le collaborateur reçoit 🔔 + email "Document prêt".
"""
from pathlib import Path

from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from employees.models import Employee, Notification
from workflows import engine
from workflows.models import Request, Workflow

from .models import MAX_FILE_SIZE, DocumentRequest
from .pdf import TEMPLATES


@transaction.atomic
def request_document(employee, doc_type, purpose=""):
    """Le collaborateur demande un document. Une règle refusée -> ValidationError({"doc_type": [...]})."""
    # Deux clics "Envoyer" en même temps : le second attend le premier, puis voit la demande déjà en cours.
    Employee.objects.select_for_update().get(pk=employee.pk)
    if not doc_type.is_active:
        raise ValidationError({"doc_type": ["Ce document n'est plus proposé."]})
    # Une seule demande en cours par type (standard) : à valider, ou validée et pas encore livrée par les RH.
    waiting = Q(request__status=Request.Status.IN_PROGRESS) | Q(request__status=Request.Status.APPROVED, file="")
    if DocumentRequest.objects.filter(waiting, employee=employee, doc_type=doc_type).exists():
        raise ValidationError({"doc_type": ["Vous avez déjà une demande en cours pour ce document."]})

    purpose = (purpose or "").strip()[:200]
    title = f"{doc_type.name} ({purpose})" if purpose else doc_type.name
    request = engine.submit(Workflow.Code.ADMIN_REQUEST, employee, title)
    document = DocumentRequest.objects.create(request=request, employee=employee, doc_type=doc_type, purpose=purpose)
    # (Garde-fou) un circuit qui accepte tout de suite : le handler est passé AVANT que le document existe.
    if request.status == Request.Status.APPROVED and doc_type.template:
        generate(document)
    return document


def deliver(document, content, name, user=None):
    """Range le fichier, donne la référence, et prévient le collaborateur (🔔 + email "Document prêt")."""
    if not document.reference:
        document.reference = f"DOC-{timezone.localdate():%Y}-{document.pk:05d}"  # unique : le numéro de la demande
    document.file.save(name, content, save=False)
    document.file_name = name[:200]
    document.delivered_at, document.delivered_by = timezone.now(), user
    document.save(update_fields=["reference", "file", "file_name", "delivered_at", "delivered_by"])
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
    if file is None:
        raise ValidationError("Choisissez le fichier PDF.")
    if Path(file.name).suffix.lower() != ".pdf":
        raise ValidationError("Seulement un PDF (le document signé, scanné).")
    if file.size > MAX_FILE_SIZE:
        raise ValidationError("Le document dépasse 5 Mo.")
    return deliver(document, file, file.name, user)
