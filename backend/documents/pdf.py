"""Les documents que l'APPLICATION génère (reportlab, comme le PDF des notes de frais).

Aujourd'hui un seul modèle : l'attestation de travail (le texte standard marocain). L'employeur est l'ENTITÉ du
collaborateur (la société : "Silent Believers Distribution", "Eureka"...), le signataire celui de son pôle
(DocumentSignatory). Quand les RH donneront LEUR modèle, on change seulement ce fichier.
"""
import re
from io import BytesIO
from xml.sax.saxutils import escape  # un "&" ou un "<" dans un nom ne casse pas le PDF (Paragraph lit du "HTML")

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from employees.models import Employee

from .models import DocumentSignatory

NAVY = colors.HexColor("#192646")
GREY = colors.HexColor("#64748B")


def signatory_of(employee):
    """Le signataire du pôle du collaborateur (les valeurs par défaut s'il n'est pas encore réglé par Admin RH)."""
    pole = employee.department.direction.entity.pole
    return DocumentSignatory.objects.filter(pole=pole).first() or DocumentSignatory(pole=pole)


def picture(field, max_width, max_height):
    """Une image enregistrée (signature, cachet) -> une image du PDF, à sa taille maximum SANS la déformer.
    Fichier absent ou illisible : None (le PDF garde la place vide, rien ne casse)."""
    if not field:
        return None
    try:
        with field.open("rb") as file:
            data = file.read()
        width, height = ImageReader(BytesIO(data)).getSize()
    except Exception:  # noqa: BLE001 (un fichier effacé ou abîmé ne doit pas empêcher l'attestation)
        return None
    scale = min(max_width / width, max_height / height)
    return Image(BytesIO(data), width=width * scale, height=height * scale)


def signature_block(signatory, signed=True):
    """Sous "Le Directeur des Ressources Humaines" : la signature et le cachet (mode IMAGE, réglé par Admin RH),
    sinon une place vide pour signer et tamponner à la main (aussi le brouillon : signed=False)."""
    images = []
    if signed and signatory.mode == DocumentSignatory.Mode.IMAGE:
        images = [image for image in (picture(signatory.stamp, 38 * mm, 38 * mm),
                                      picture(signatory.signature, 55 * mm, 26 * mm)) if image]
    if not images:
        return [Spacer(1, 70)]  # la place de la signature et du cachet, à la main
    table = Table([images], hAlign="RIGHT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 4)]))
    return [Spacer(1, 4), table, Spacer(1, 16)]


def work_certificate_text(document):
    """Le TEXTE de l'attestation de travail (le corps, sans l'en-tête, la référence ni la signature), rempli avec la
    fiche. Du texte simple : une ligne vide = un nouveau paragraphe, **mot** = en gras. C'est ce que les RH peuvent
    relire et modifier avant l'envoi (step 3, 2026-11-16) ; le cadre du document, lui, ne change jamais."""
    employee = document.employee
    company = employee.department.direction.entity.name
    e = "e" if employee.title == Employee.Title.MRS else ""  # les accords : "employée", "l'intéressée"
    civility = "Madame" if e else "Monsieur"
    hired = f"{employee.hire_date:%d/%m/%Y}"
    if employee.status == Employee.Status.LEFT and employee.departure_date:
        work = (f"a été employé{e} au sein de notre société du {hired} au {employee.departure_date:%d/%m/%Y}, "
                f"en qualité de **{employee.position.name}** (service {employee.department.name}).")
    else:
        work = (f"est employé{e} au sein de notre société depuis le {hired}, en qualité de **{employee.position.name}** "
                f"(service {employee.department.name}).")
    return (f"Nous soussignés, **{company}**, attestons par la présente que {civility} "
            f"**{employee.last_name.upper()} {employee.first_name}**, titulaire de la carte d'identité nationale "
            f"n° **{employee.cin}**, {work}\n\n"
            f"Cette attestation est délivrée à l'intéressé{e}, sur sa demande, pour servir et valoir ce que de droit.")


def paragraphs(text, style):
    """Le texte simple -> les paragraphes du PDF : une ligne vide = un paragraphe, **mot** = gras. Échappé d'abord
    (un "<" tapé par un RH ne casse pas le PDF), puis les ** deviennent <b>."""
    blocks = [block.strip() for block in re.split(r"\n\s*\n", text.replace("\r", "")) if block.strip()]
    return [Paragraph(re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escape(block)).replace("\n", "<br/>"), style)
            for block in blocks]


def work_certificate(document, signed=True, text=None):
    """L'attestation de travail de cette demande, en octets (le fichier PDF).
    signed=False : le brouillon des RH (sans les images de signature et de cachet), à signer à la main.
    text : le corps à utiliser (un aperçu) ; sinon celui relu par les RH (document.body), sinon le texte de la fiche."""
    employee = document.employee
    company = escape(employee.department.direction.entity.name)
    signatory = signatory_of(employee)
    body_text = text if text is not None else (document.body or work_certificate_text(document))

    buffer = BytesIO()
    pdf = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=25 * mm, rightMargin=25 * mm, topMargin=22 * mm,
                            bottomMargin=20 * mm, title=f"Attestation de travail - {employee.last_name} {employee.first_name}")
    styles = getSampleStyleSheet()
    header = styles["Normal"].clone("header", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=NAVY)
    small = styles["Normal"].clone("small", fontSize=8.5, textColor=GREY, leading=11)
    title = styles["Title"].clone("title", fontSize=17, textColor=NAVY, alignment=TA_CENTER, spaceBefore=26, spaceAfter=4)
    body = styles["Normal"].clone("body", fontSize=11, leading=18, alignment=TA_JUSTIFY, spaceAfter=10)
    right = styles["Normal"].clone("right", fontSize=11, leading=16, alignment=TA_RIGHT)

    today = timezone.localdate()

    story = [
        Paragraph(company, header),
        Paragraph("Direction des Ressources Humaines", small),
        Spacer(1, 4),
        HRFlowable(width="100%", thickness=0.8, color=NAVY),
        Paragraph("ATTESTATION DE TRAVAIL", title),
        Paragraph(f"Réf. : {document.reference}", styles["Normal"].clone("ref", fontSize=9, textColor=GREY, alignment=TA_CENTER)),
        Spacer(1, 26),
        *paragraphs(body_text, body),  # le corps : le seul morceau que les RH peuvent modifier
        Spacer(1, 22),
        Paragraph(f"Fait à {escape(signatory.city)}, le {today:%d/%m/%Y}", right),
        Spacer(1, 16),
        Paragraph(f"<b>{escape(signatory.title)}</b>", right),
    ]
    if signatory.name:
        story.append(Paragraph(escape(signatory.name), right))
    story += signature_block(signatory, signed)
    story += [
        HRFlowable(width="100%", thickness=0.4, color=GREY),
        Spacer(1, 4),
        Paragraph(f"Document établi le {today:%d/%m/%Y} par l'Intranet RH, référence {document.reference}. "
                  "Pour vérifier ce document, contactez la Direction des Ressources Humaines en donnant sa référence.", small),
    ]
    pdf.build(story)
    return buffer.getvalue()


# Le modèle (DocumentType.template) -> la fonction qui fabrique son PDF, et celle qui donne son texte modifiable.
TEMPLATES = {"WORK": work_certificate}
TEXTS = {"WORK": work_certificate_text}
