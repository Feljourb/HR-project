"""Notes de frais : envoyer une note (step 4) et la marquer remboursée (step 5).

Comme les congés : le module vérifie SES règles (lignes, plafonds du grade, justificatifs), puis il donne
la demande au moteur des circuits (engine.submit("EXPENSE")) : N+1 valide, puis RH informée.
"""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from employees.models import Employee
from workflows import engine
from workflows.models import Request, Workflow

from .models import ExpenseClaim, ExpenseLine

MAX_LINES = 50


def money(value):
    """1250.5 -> "1 250,50" (à la marocaine / française)."""
    return f"{value:,.2f}".replace(",", " ").replace(".", ",")


@transaction.atomic
def submit_claim(employee, title, lines):
    """Envoie une note de frais. `lines` : [{"date", "category", "amount", "description", "receipt"}, ...]
    (receipt : le fichier envoyé, ou None).
    Une règle refusée -> ValidationError({"title": [...]} ou {"line_0": [...], "line_2": [...]}) :
    le formulaire affiche chaque message sous SA ligne. Rien n'est enregistré (transaction)."""
    # Deux clics "Envoyer" en même temps : le second attend le premier (comme pour les congés).
    Employee.objects.select_for_update().get(pk=employee.pk)

    errors = {}
    title = (title or "").strip()
    if not title:
        errors["title"] = ["Donnez un objet à la note (ex. « Mission Agadir »)."]
    if not lines:
        errors["lines"] = ["Ajoutez au moins une dépense."]
    elif len(lines) > MAX_LINES:
        errors["lines"] = [f"Au plus {MAX_LINES} dépenses par note : faites-en une deuxième."]

    claim = ExpenseClaim(employee=employee, title=title)
    built = []
    for index, data in enumerate(lines or []):
        receipt = data.get("receipt")
        line = ExpenseLine(
            claim=claim, date=data.get("date"), category=data.get("category"), amount=data.get("amount"),
            description=(data.get("description") or "").strip(), receipt=receipt,
            receipt_name=(receipt.name[:200] if receipt else ""),
        )
        try:
            line.full_clean(exclude=["claim"])  # les règles de la ligne (date, plafond, justificatif...)
        except ValidationError as problem:
            errors[f"line_{index}"] = problem.messages
        built.append(line)
    if errors:
        raise ValidationError(errors)

    claim.total = sum(line.amount for line in built)
    claim.request = engine.submit(Workflow.Code.EXPENSE, employee, f"Note de frais : {title} ({money(claim.total)} MAD)")
    claim.save()
    for line in built:
        line.claim = claim
        line.save()  # le justificatif est écrit dans media/receipts/... à ce moment-là
    return claim


def can_reimburse(user, claim):
    """Les RH du pôle du collaborateur (et Admin RH), jamais le collaborateur lui-même (comme pour valider)."""
    return engine.hr_validators(claim.employee).filter(pk=user.pk).exists()


@transaction.atomic
def mark_reimbursed(claim, user):
    """Le RH a payé : la note passe "Remboursée" (date et qui)."""
    claim = ExpenseClaim.objects.select_for_update().select_related("request", "employee").get(pk=claim.pk)
    if not can_reimburse(user, claim):
        raise PermissionDenied("Seuls les RH du pôle peuvent noter un remboursement.")
    if claim.request.status != Request.Status.APPROVED:
        raise ValidationError("Seule une note validée peut être remboursée.")
    if claim.reimbursed_at:
        raise ValidationError("Cette note est déjà remboursée.")
    claim.reimbursed_at, claim.reimbursed_by = timezone.localdate(), user
    claim.save(update_fields=["reimbursed_at", "reimbursed_by"])
    return claim
