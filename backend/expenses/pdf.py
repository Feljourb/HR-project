"""Le PDF d'une note de frais (step 4) : le collaborateur l'imprime après la validation du N+1
et l'apporte aux RH avec les justificatifs papier (décision du 2026-11-03).

Fait avec reportlab (une bibliothèque Python qui dessine des PDF) : un titre, qui, la liste des dépenses,
le total, le circuit (qui a validé, quand), et deux cases de signature.
"""
from io import BytesIO

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .services import money

NAVY = colors.HexColor("#192646")
GREY = colors.HexColor("#64748B")
LINE = colors.HexColor("#E2E8F0")


def claim_pdf(claim):
    """Le PDF de cette note, en octets (pour la réponse HTTP)."""
    buffer = BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                                 topMargin=16 * mm, bottomMargin=16 * mm, title=f"Note de frais - {claim.title}")
    styles = getSampleStyleSheet()
    title = styles["Title"].clone("t", textColor=NAVY, alignment=0, fontSize=18, spaceAfter=2)
    small = styles["Normal"].clone("s", fontSize=8.5, textColor=GREY)
    normal = styles["Normal"].clone("n", fontSize=9.5)
    heading = styles["Heading3"].clone("h", textColor=NAVY, spaceBefore=10, spaceAfter=4)

    employee, request = claim.employee, claim.request
    story = [
        Paragraph("Silent Believers Distribution · Ressources humaines", small),
        Paragraph(f"Note de frais : {claim.title}", title),
        Paragraph(f"N° {request.pk} · envoyée le {timezone.localtime(request.created_at):%d/%m/%Y} · "
                  f"statut : {request.get_status_display()}", small),
        Spacer(1, 8),
    ]

    # Qui : le collaborateur, son service et son grade (le barème appliqué).
    who = [
        ["Collaborateur", f"{employee.last_name} {employee.first_name}", "Matricule", employee.u_number or "-"],
        ["Service", employee.department.name, "Grade", str(employee.grade or "-")],
    ]
    who_table = Table(who, colWidths=[28 * mm, 62 * mm, 24 * mm, 60 * mm])
    who_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (0, -1), GREY), ("TEXTCOLOR", (2, 0), (2, -1), GREY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(who_table)

    # Les dépenses, puis le total.
    story.append(Paragraph("Dépenses", heading))
    rows = [["Date", "Catégorie", "Détail", "Justificatifs", "Montant (MAD)"]]
    for line in claim.lines.select_related("category").prefetch_related("receipts"):
        count = len(line.receipts.all())  # le nombre de pièces à joindre (ex. facture + ticket de carte = 2)
        rows.append([f"{line.date:%d/%m/%Y}", Paragraph(str(line.category), normal), Paragraph(line.description or "-", normal),
                     str(count) if count else "Non", money(line.amount)])
    rows.append(["", "", "", "Total", money(claim.total)])
    lines_table = Table(rows, colWidths=[22 * mm, 50 * mm, 52 * mm, 22 * mm, 28 * mm], repeatRows=1)
    lines_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (4, 0), (4, -1), "RIGHT"), ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.5, LINE),
        ("FONTNAME", (3, -1), (4, -1), "Helvetica-Bold"), ("LINEABOVE", (3, -1), (4, -1), 1, NAVY),
    ]))
    story.append(lines_table)

    # Le circuit : chaque étape, qui a répondu, quand.
    story.append(Paragraph("Circuit de validation", heading))
    steps = [["Étape", "Qui", "Décision", "Date"]]
    for step in request.steps.select_related("assignee", "decided_by"):
        who_step = f"{step.assignee.first_name} {step.assignee.last_name}" if step.assignee else step.get_approver_display()
        when = f"{timezone.localtime(step.decided_at):%d/%m/%Y %H:%M}" if step.decided_at else "-"
        steps.append([f"{step.order}. {step.get_approver_display()} ({step.get_mode_display()})", who_step,
                      step.get_status_display(), when])
    steps_table = Table(steps, colWidths=[52 * mm, 52 * mm, 34 * mm, 36 * mm])
    steps_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, 0), GREY),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(steps_table)

    # Les signatures, sur le papier que le collaborateur apporte aux RH.
    story.append(Spacer(1, 18))
    signatures = Table([["Signature du collaborateur", "Visa RH (reçu le ... / ... / ......)"], ["", ""]],
                       colWidths=[87 * mm, 87 * mm], rowHeights=[6 * mm, 22 * mm])
    signatures.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, 0), GREY),
        ("BOX", (0, 1), (0, 1), 0.5, LINE), ("BOX", (1, 1), (1, 1), 0.5, LINE),
    ]))
    story.append(signatures)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Joindre les justificatifs papier (tickets, factures) à cette note.", small))

    document.build(story)
    return buffer.getvalue()
