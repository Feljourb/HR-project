"""Documents administratifs : demander un document, le générer, le déposer (RH).

Comme les congés et les notes de frais : le module vérifie SES règles, puis donne la demande au moteur
(engine.submit("ADMIN_REQUEST") : les RH du pôle valident). Après la validation (handlers.py) :
- type avec un modèle : le PDF est généré tout de suite (generate) ;
- sinon : les RH du pôle déposent le PDF signé (upload).
Dans les deux cas, le collaborateur reçoit 🔔 + email "Document prêt".
"""
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

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

from .merge import check_model, fill, values_of
from .models import MAX_FILE_SIZE, DocumentRequest, DocumentSettings, DocumentSignatory
from .pdf import TEMPLATES, TEXTS, signatory_of


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


def earliest_needed_by(today=None, days=None):
    """La "Date souhaitée" la plus proche possible (2026-11-17) : aujourd'hui + N jours (réglage d'Admin RH, 2 par
    défaut), sans compter les DIMANCHES ni les jours fériés actifs. Ex. demandé mardi 17 -> au plus tôt jeudi 19 ;
    un jour férié au milieu -> un jour de plus."""
    today = today or timezone.localdate()
    days = DocumentSettings.load().min_notice_days if days is None else days
    ensure_years(today, today + timedelta(days=days * 2 + 14))
    holidays = set(PublicHoliday.objects.filter(is_active=True, date__gt=today, date__lte=today + timedelta(days=days * 2 + 14))
                   .values_list("date", flat=True))
    day = today
    while days > 0:
        day += timedelta(days=1)
        if day.weekday() != 6 and day not in holidays:  # 6 = dimanche
            days -= 1
    return day


def next_pickup(moment, days):
    """Le prochain jour de RETRAIT d'un original au bureau RH (l'après-midi), pour une demande faite à `moment`
    (2026-11-17, comme l'outil actuel des RH). Ex. jours = mercredi + vendredi : demandé lundi -> mercredi ; mercredi
    à 10 h -> mercredi ; mercredi à 15 h -> vendredi ; vendredi à 15 h -> mercredi suivant. Un jour férié est sauté.
    None : pas de jours de retrait choisis."""
    days = {day for day in days or [] if isinstance(day, int) and 0 <= day <= 4}
    if not days:
        return None
    local = timezone.localtime(moment)
    day = local.date() if local.hour < 12 else local.date() + timedelta(days=1)  # l'après-midi : trop tard aujourd'hui
    ensure_years(day, day + timedelta(days=30))
    holidays = set(PublicHoliday.objects.filter(is_active=True, date__gte=day, date__lte=day + timedelta(days=30))
                   .values_list("date", flat=True))
    for _ in range(31):
        if day.weekday() in days and day not in holidays:
            return day
        day += timedelta(days=1)
    return None


FORMAT_IN_TITLE = {DocumentRequest.Format.ORIGINAL: "original", DocumentRequest.Format.BOTH: "PDF + original"}


def is_manager_of(user, employee):
    """Ce compte est le N+1 du collaborateur (le même organigramme que les validations)."""
    boss = employee.n_plus_1
    return boss is not None and boss.user_id == user.pk


def request_document(employee, doc_type, purpose="", by=None, format=DocumentRequest.Format.PDF, needed_by=None):
    """UN document (les démos, les tests) : une demande avec ce seul document."""
    return request_documents(employee, [doc_type], purpose, by, format, needed_by)[0]


@transaction.atomic
def request_documents(employee, doc_types, purpose="", by=None, format=DocumentRequest.Format.PDF, needed_by=None):
    """Demander UN OU PLUSIEURS documents dans UNE demande (2026-11-17 : "Documents demandés", cases à cocher, comme
    l'outil actuel des RH) : les RH valident une fois, puis chaque document suit son chemin. Rend les documents créés.
    Une règle refusée -> ValidationError({"doc_type": [...]}).
    format : PDF, ORIGINAL (papier signé à la main, à récupérer au bureau RH) ou BOTH.
    - par le collaborateur lui-même (by vide, ou lui) : la demande suit le circuit (les RH du pôle valident) ;
    - par un RH POUR un collaborateur (champ "Employé (RH)", standard "request on behalf of") : les RH sont
      l'autorité, la demande est ACCEPTÉE tout de suite (engine.record_approved, l'historique dit qui l'a faite) ;
    - par son MANAGER (N+1) pour lui (2026-11-16, standard "Manager Self-Service" : un ouvrier qui n'utilise pas
      l'application), seulement les types choisis par Admin RH : la demande suit le circuit (les RH valident),
      le collaborateur est prévenu ; le manager voit où elle en est, jamais le document."""
    for_other = by is not None and by.pk != employee.user_id
    hr = for_other and can_prepare(by, DocumentRequest(employee=employee))
    manager = for_other and not hr and is_manager_of(by, employee)
    if for_other and not (hr or manager):
        raise PermissionDenied("Seuls les RH du pôle ou le manager (N+1) du collaborateur demandent un document pour lui.")
    options = DocumentSettings.load()
    if manager and not options.manager_allowed(by):
        # Le réglage d'Admin RH (2026-11-17) : fermé, ou ouvert seulement à certains managers.
        raise PermissionDenied("Votre entreprise ne permet pas aux managers de demander un document pour leur équipe : "
                               "demandez aux RH.")
    if not hr and format not in options.formats():
        # Les RH gardent tous les formats (ils préparent eux-mêmes) ; les autres : ceux qu'Admin RH propose.
        raise ValidationError({"format": ["Ce format n'est pas proposé : choisissez-en un autre."]})
    doc_types = list(dict.fromkeys(doc_types))  # le même coché deux fois : une seule fois
    if not doc_types:
        raise ValidationError({"doc_type": ["Choisissez au moins un document."]})
    if manager and any(not doc_type.manager_can_request for doc_type in doc_types):
        names = ", ".join(doc_type.name for doc_type in doc_types if not doc_type.manager_can_request)
        raise ValidationError({"doc_type": [f"Ce document ne se demande pas par le manager ({names}) : le collaborateur "
                                            "ou les RH le demandent."]})
    # Deux clics "Envoyer" en même temps : le second attend le premier, puis voit la demande déjà en cours.
    Employee.objects.select_for_update().get(pk=employee.pk)
    if any(not doc_type.is_active for doc_type in doc_types):
        raise ValidationError({"doc_type": ["Un de ces documents n'est plus proposé."]})
    if format not in DocumentRequest.Format.values:
        raise ValidationError({"format": ["Choisissez le format : PDF, original ou les deux."]})
    if needed_by is not None and needed_by < timezone.localdate():
        raise ValidationError({"needed_by": ["La date souhaitée ne peut pas être dans le passé."]})
    # Le délai minimum (sauf pour les RH, qui s'organisent eux-mêmes) : le temps de préparer et de signer.
    earliest = earliest_needed_by()
    if needed_by is not None and not hr and needed_by < earliest:
        raise ValidationError({"needed_by": [f"Date souhaitée au plus tôt le {earliest:%d/%m/%Y} (le temps de préparer "
                                             "et de signer le document)."]})
    # Une seule demande en cours par type (standard) : à valider, ou validée et pas encore préparée par les RH.
    waiting = Q(request__status=Request.Status.IN_PROGRESS) | DocumentRequest.to_prepare_filter()
    busy = DocumentRequest.objects.filter(waiting, employee=employee, doc_type__in=doc_types).select_related("doc_type")
    if busy.exists():
        names = ", ".join(sorted({document.doc_type.name for document in busy}))
        raise ValidationError({"doc_type": [f"Une demande est déjà en cours pour : {names}."]})

    purpose = (purpose or "").strip()[:200]
    # Le titre (Team approvals, l'historique, la cloche) dit tout de suite au RH quoi, et s'il faut un original papier :
    # "Attestation de travail + Attestation de salaire (Banque) · original".
    names = " + ".join(doc_type.name for doc_type in doc_types)
    title = f"{names} ({purpose})" if purpose else names
    if format in FORMAT_IN_TITLE:
        title = f"{title} · {FORMAT_IN_TITLE[format]}"
    title = title[:200]  # la longueur maximum d'un titre de demande (un motif très long)
    if hr:
        request = engine.record_approved(Workflow.Code.ADMIN_REQUEST, employee, title, by,
                                         f"Demandé par les RH pour {person(employee)}.")
    else:
        # Le manager : la demande est au nom du collaborateur, "saisie par" le manager (il suit l'historique).
        request = engine.submit(Workflow.Code.ADMIN_REQUEST, employee, title, initiated_by=by if manager else None)
    # Un document par type coché, chacun avec SON délai : un original papier -> le prochain jour de retrait au bureau
    # RH (réglage d'Admin RH) ; sinon le délai du type (généré : tout de suite ; préparé : N jours ouvrés).
    pickup = next_pickup(timezone.now(), options.pickup_days) if format != DocumentRequest.Format.PDF else None
    created = [DocumentRequest.objects.create(
        request=request, employee=employee, doc_type=doc_type, purpose=purpose, format=format, needed_by=needed_by,
        requested_by=by if for_other else None,
        due_date=pickup or add_working_days(timezone.localdate(), 0 if doc_type.template else doc_type.delivery_days))
        for doc_type in doc_types]
    if manager:
        # 🔔 + email au collaborateur : une demande a été faite EN SON NOM.
        Notification.objects.create(recipient=employee.user, employee=employee,
                                    kind=Notification.Kind.REQUESTED_FOR, request=request)
    # Déjà acceptée (demandée par les RH) : le handler est passé AVANT que les documents existent -> on génère ici.
    if request.status == Request.Status.APPROVED:
        for document in created:
            if document.doc_type.template:
                generate(document)
    return created


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
        tell(document, Notification.Kind.DOCUMENT_READY)
    return document


def tell(document, kind):
    """🔔 + email au collaborateur, et à celui qui a SAISI la demande pour lui (son manager, 2026-11-16 : un ouvrier
    qui n'utilise pas l'application ; le manager le prévient). Le manager ne reçoit jamais le document lui-même."""
    people = [document.employee.user]
    initiator = document.request.initiated_by
    if initiator and initiator.pk != document.employee.user_id:
        people.append(initiator)
    Notification.objects.bulk_create(Notification(recipient=user, employee=document.employee, kind=kind,
                                                   request=document.request) for user in people)


def auto_signed(document):
    """Le pôle du collaborateur a choisi "signature et cachet ajoutés par l'application" (et la signature existe)."""
    signatory = signatory_of(document.employee)
    return signatory.mode == DocumentSignatory.Mode.IMAGE and bool(signatory.signature)


def generate(document, reviewed=False):
    """Le type a un modèle : l'application fabrique le PDF (ex. l'attestation de travail), après la validation.
    - "Relecture RH avant l'envoi" (Admin RH, step 3) et pas encore relu : RIEN n'est fabriqué ; les RH relisent le
      texte (save_text), qui rappelle generate(reviewed=True).
    - Signature "par l'application" (Admin RH) et le collaborateur veut le PDF : livré tout de suite, signé.
    - Signature "à la main", ou un original papier demandé : un BROUILLON sans signature pour les RH seulement
      (step D, 2026-11-13 : jamais un document non signé chez le collaborateur). Ils l'impriment, le signent et
      le tamponnent ; puis ils scannent et déposent le PDF signé (upload), et / ou remettent l'original."""
    if not document.reference:
        # La référence est écrite DANS le PDF : on la donne avant de le fabriquer.
        document.reference = f"DOC-{timezone.localdate():%Y}-{document.pk:05d}"
    if document.doc_type.hr_review and not reviewed:
        document.save(update_fields=["reference"])
        return document  # "To prepare" : les RH relisent d'abord
    make = TEMPLATES[document.doc_type.template]
    name = f"{document.doc_type.name} - {document.employee.last_name} {document.employee.first_name}"
    signed = auto_signed(document)
    if document.needs_original or not signed:
        document.draft.save(f"{name} (brouillon).pdf", ContentFile(make(document, signed=False)), save=False)
        document.save(update_fields=["reference", "draft"])
    if document.needs_pdf and signed:
        return deliver(document, ContentFile(make(document)), f"{name}.pdf")
    return document


def draft_bytes(document):
    """"Download" des RH (2026-11-17) pour un document GÉNÉRÉ : le PDF SANS signature, avec le texte du moment (celui
    relu par un RH, sinon celui de la fiche), à imprimer, signer et tamponner. Fabriqué à la demande : marche aussi
    avant la relecture ("Customize" est facultatif)."""
    if not document.reference:
        document.reference = f"DOC-{timezone.localdate():%Y}-{document.pk:05d}"
        document.save(update_fields=["reference"])
    return TEMPLATES[document.doc_type.template](document, signed=False, text=text_of(document))


MODEL_EXTENSIONS = (".docx", ".doc", ".odt", ".pdf")


def set_model(doc_type, file):
    """Admin RH met (ou remplace) le modèle Word / PDF d'un type préparé par les RH. 5 Mo au plus."""
    if file is None:
        raise ValidationError("Choisissez un fichier Word ou PDF.")
    suffix = Path(file.name).suffix.lower()
    if suffix not in MODEL_EXTENSIONS:
        raise ValidationError("Le modèle doit être un fichier Word (.docx, .doc), OpenOffice (.odt) ou PDF.")
    if file.size > MAX_FILE_SIZE:
        raise ValidationError("Le modèle dépasse 5 Mo.")
    if suffix == ".docx":
        check_model(file)  # le publipostage : ses codes {{ nom }} bien écrits
    if doc_type.model_file:
        doc_type.model_file.delete(save=False)  # l'ancien modèle n'est plus utilisé nulle part
    doc_type.model_file.save(f"{uuid4().hex}{suffix}", file, save=False)  # un nom au hasard : jamais deviné
    doc_type.model_name = file.name[:200]
    doc_type.save(update_fields=["model_file", "model_name"])
    return doc_type


def filled_model(document):
    """"Download the model" (2026-11-17) : un modèle .docx -> rempli avec les données du collaborateur (publipostage) ;
    un autre format (.doc, .odt, .pdf) -> tel quel. Rend (octets, nom du fichier)."""
    model = document.doc_type.model_file
    name = document.doc_type.model_name or "modele"
    if not Path(model.name).suffix.lower() == ".docx":
        with model.open("rb") as source:
            return source.read(), name
    if not document.reference:
        document.reference = f"DOC-{timezone.localdate():%Y}-{document.pk:05d}"
        document.save(update_fields=["reference"])
    employee = document.employee
    try:
        content = fill(model, values_of(document))
    except Exception:  # noqa: BLE001 (un modèle abîmé : on le donne tel quel plutôt que rien)
        with model.open("rb") as source:
            return source.read(), name
    return content, f"{document.doc_type.name} - {employee.last_name} {employee.first_name}.docx"


MAX_TEXT = 5000  # le texte d'une attestation : quelques paragraphes


def text_of(document):
    """Le texte à relire : celui déjà relu par un RH, sinon celui de la fiche (le modèle rempli)."""
    return document.body or TEXTS[document.doc_type.template](document)


@transaction.atomic
def save_text(document, user, text):
    """Step 3 (2026-11-16) : un RH relit / modifie le TEXTE d'un document généré pas encore livré (seulement le
    corps : l'en-tête, la référence et la signature ne changent pas), puis le document est (re)fabriqué :
    signé par l'application -> livré au collaborateur ; à signer à la main -> le brouillon à imprimer est refait.
    La trace : qui a relu, et quand."""
    document = DocumentRequest.objects.select_for_update().select_related("request", "doc_type", "employee__user").get(pk=document.pk)
    if not can_prepare(user, document):
        raise PermissionDenied("Seuls les RH du pôle du collaborateur relisent ce document.")
    if not document.doc_type.template:
        raise ValidationError("Ce document est préparé par les RH (pas de texte généré à relire).")
    if document.request.status != Request.Status.APPROVED:
        raise ValidationError("Le texte se relit après la validation de la demande.")
    if document.file:
        raise ValidationError("Ce document est déjà livré : il ne change plus.")
    text = (text or "").strip()
    if not text:
        raise ValidationError("Le texte ne peut pas être vide.")
    if len(text) > MAX_TEXT:
        raise ValidationError(f"Le texte est trop long (au plus {MAX_TEXT} caractères).")
    document.body, document.body_edited_by, document.body_edited_at = text, user, timezone.now()
    document.save(update_fields=["body", "body_edited_by", "body_edited_at"])
    return generate(document, reviewed=True)


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
    must_review_first(document)
    # Un document livré ne change plus (décision de l'utilisatrice, 2026-11-13 : la trace d'abord ; le collaborateur
    # l'a peut-être déjà donné à sa banque). Une erreur -> une NOUVELLE demande (les RH : "Employee (HR)"), nouvelle
    # référence ; l'ancienne reste dans l'historique.
    if document.file:
        raise ValidationError("Ce document est déjà livré et ne se remplace pas. Pour une correction, faites une "
                              "nouvelle demande pour ce collaborateur.")
    if file is None:
        raise ValidationError("Choisissez le fichier PDF.")
    if Path(file.name).suffix.lower() != ".pdf":
        raise ValidationError("Seulement un PDF (le document signé, scanné).")
    if file.size > MAX_FILE_SIZE:
        raise ValidationError("Le document dépasse 5 Mo.")
    return deliver(document, file, file.name, user)


def must_review_first(document):
    """Step 3 : un type "Relecture RH" pas encore relu : rien ne part (ni PDF déposé, ni original) avant la relecture."""
    if document.doc_type.template and document.doc_type.hr_review and not document.body_edited_at:
        raise ValidationError("Relisez d'abord le texte du document (Review & send).")


def original_to_handle(document, user):
    """Relit la demande verrouillée et vérifie qu'un RH peut s'occuper de son ORIGINAL papier."""
    # (Pas "request__initiated_by" ici : PostgreSQL refuse de verrouiller une jointure qui peut être vide.)
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
    must_review_first(document)
    if document.original_ready_at:
        raise ValidationError("L'original est déjà prêt.")
    document.original_ready_at, document.original_ready_by = timezone.now(), user
    document.save(update_fields=["original_ready_at", "original_ready_by"])
    tell(document, Notification.Kind.ORIGINAL_READY)  # le collaborateur (+ son manager, s'il l'a demandé pour lui)
    return document


@transaction.atomic
def mark_handed_over(document, user, to_manager=False):
    """L'original est remis en main propre : au collaborateur, ou à son MANAGER venu pour lui (to_manager, 2026-11-16).
    La trace : quand, par quel RH, à qui. Remis au manager : le collaborateur est prévenu."""
    document = original_to_handle(document, user)
    if not document.original_ready_at:
        raise ValidationError("Marquez d'abord l'original comme prêt.")
    if document.collected_at:
        raise ValidationError("L'original est déjà remis.")
    taker = document.employee
    if to_manager:
        taker = document.employee.n_plus_1
        if taker is None:
            raise ValidationError("Ce collaborateur n'a pas de manager (N+1) : remettez l'original au collaborateur.")
    document.collected_at, document.collected_by, document.handed_to = timezone.now(), user, taker
    document.save(update_fields=["collected_at", "collected_by", "handed_to"])
    if to_manager:
        Notification.objects.create(recipient=document.employee.user, employee=document.employee,
                                    kind=Notification.Kind.ORIGINAL_HANDED, request=document.request)
    return document
