"""Les documents que l'APPLICATION génère (reportlab, comme le PDF des notes de frais).

Aujourd'hui un seul modèle : l'attestation de travail (le texte standard marocain). L'employeur est l'ENTITÉ du
collaborateur (la société : "Silent Believers Distribution", "Eureka"...), le signataire celui de son pôle
(DocumentSignatory). Quand les RH donneront LEUR modèle, on change seulement ce fichier.
"""
from io import BytesIO
from xml.sax.saxutils import escape  # un "&" ou un "<" dans un nom ne casse pas le PDF (Paragraph lit du "HTML")

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer

from employees.models import Employee

from .models import DocumentSignatory

NAVY = colors.HexColor("#192646")
GREY = colors.HexColor("#64748B")


def signatory_of(employee):
    """Le signataire du pôle du collaborateur (les valeurs par défaut s'il n'est pas encore rempli dans /admin)."""
    pole = employee.department.direction.entity.pole
    return DocumentSignatory.objects.filter(pole=pole).first() or DocumentSignatory(pole=pole)


def work_certificate(document):
    """L'attestation de travail de cette demande, en octets (le fichier PDF)."""
    employee = document.employee
    company = escape(employee.department.direction.entity.name)
    signatory = signatory_of(employee)
    woman = employee.title == Employee.Title.MRS
    e = "e" if woman else ""  # les accords : "employée", "l'intéressée"

    buffer = BytesIO()
    pdf = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=25 * mm, rightMargin=25 * mm, topMargin=22 * mm,
                            bottomMargin=20 * mm, title=f"Attestation de travail - {employee.last_name} {employee.first_name}")
    styles = getSampleStyleSheet()
    header = styles["Normal"].clone("header", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=NAVY)
    small = styles["Normal"].clone("small", fontSize=8.5, textColor=GREY, leading=11)
    title = styles["Title"].clone("title", fontSize=17, textColor=NAVY, alignment=TA_CENTER, spaceBefore=26, spaceAfter=4)
    body = styles["Normal"].clone("body", fontSize=11, leading=18, alignment=TA_JUSTIFY, spaceAfter=10)
    right = styles["Normal"].clone("right", fontSize=11, leading=16, alignment=TA_RIGHT)

    name = f"{'Madame' if woman else 'Monsieur'} <b>{escape(employee.last_name.upper())} {escape(employee.first_name)}</b>"
    hired = f"{employee.hire_date:%d/%m/%Y}"
    position, department = escape(employee.position.name), escape(employee.department.name)
    if employee.status == Employee.Status.LEFT and employee.departure_date:
        work = (f"a été employé{e} au sein de notre société du {hired} au {employee.departure_date:%d/%m/%Y}, "
                f"en qualité de <b>{position}</b> (service {department}).")
    else:
        work = (f"est employé{e} au sein de notre société depuis le {hired}, en qualité de <b>{position}</b> "
                f"(service {department}).")
    today = timezone.localdate()

    story = [
        Paragraph(company, header),
        Paragraph("Direction des Ressources Humaines", small),
        Spacer(1, 4),
        HRFlowable(width="100%", thickness=0.8, color=NAVY),
        Paragraph("ATTESTATION DE TRAVAIL", title),
        Paragraph(f"Réf. : {document.reference}", styles["Normal"].clone("ref", fontSize=9, textColor=GREY, alignment=TA_CENTER)),
        Spacer(1, 26),
        Paragraph(f"Nous soussignés, <b>{company}</b>, attestons par la présente que {name}, titulaire de la carte "
                  f"d'identité nationale n° <b>{escape(employee.cin)}</b>, {work}", body),
        Paragraph(f"Cette attestation est délivrée à l'intéressé{e}, sur sa demande, pour servir et valoir ce que "
                  "de droit.", body),
        Spacer(1, 22),
        Paragraph(f"Fait à {escape(signatory.city)}, le {today:%d/%m/%Y}", right),
        Spacer(1, 16),
        Paragraph(f"<b>{escape(signatory.title)}</b>", right),
    ]
    if signatory.name:
        story.append(Paragraph(escape(signatory.name), right))
    story += [
        Spacer(1, 70),  # la place de la signature et du cachet
        HRFlowable(width="100%", thickness=0.4, color=GREY),
        Spacer(1, 4),
        Paragraph(f"Document établi le {today:%d/%m/%Y} par l'Intranet RH, référence {document.reference}. "
                  "Pour vérifier ce document, contactez la Direction des Ressources Humaines en donnant sa référence.", small),
    ]
    pdf.build(story)
    return buffer.getvalue()


# Le modèle (DocumentType.template) -> la fonction qui fabrique son PDF.
TEMPLATES = {"WORK": work_certificate}
