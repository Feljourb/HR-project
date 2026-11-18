"""Notes de frais : envoyer une note (step 4), corriger un montant (2026-11-16) et la marquer remboursée (step 5).

Comme les congés : le module vérifie SES règles (lignes, plafonds du grade, justificatifs), puis il donne
la demande au moteur des circuits (engine.submit("EXPENSE")) : N+1 valide, puis RH valide (le contrôle, 2026-11-16).
"""
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from employees.models import Employee, Notification
from workflows import engine
from workflows.models import Request, Workflow, WorkflowStep

from .models import ExpenseCategory, ExpenseClaim, ExpenseCorrection, ExpenseLine, ExpenseReceipt, ExpenseSettings

MAX_LINES = 50


def money(value):
    """1250.5 -> "1 250,50" (à la marocaine / française)."""
    return f"{value:,.2f}".replace(",", " ").replace(".", ",")


TOTAL_OF = {
    # Ce que regroupe le maximum d'une catégorie (la clé du groupe à partir d'une ligne) :
    ExpenseCategory.Per.DAY: lambda line: (line.category_id, line.date),    # tout ce jour-là
    ExpenseCategory.Per.NIGHT: lambda line: (line.category_id, line.date),  # cette nuit-là
    ExpenseCategory.Per.TRIP: lambda line: (line.category_id, None),        # toute la mission (la note)
}
WHAT = {ExpenseCategory.Per.DAY: "ce jour-là", ExpenseCategory.Per.NIGHT: "cette nuit-là", ExpenseCategory.Per.TRIP: "cette mission"}


def check_maximums(lines):
    """Le maximum par jour / par nuit / par trajet (2026-11-18, standard SAP Concur) : les lignes d'une même catégorie
    du même jour (ou de toute la note, "par trajet") s'additionnent. Ex. Taxi, 300 MAD par jour : 100 + 120 + 80 le
    même jour = 300, permis ; une 4e ligne de 50 ce jour-là dépasse de 50.
    Chaque ligne reçoit `ceiling` = ce qui restait quand elle arrive : la ligne qui fait déborder (et les suivantes)
    dépasse ; refusée, ou permise avec une raison si Admin RH le permet. lines = [(index, line)] -> {index: message}."""
    errors, used = {}, {}
    for index, line in lines:
        group = TOTAL_OF.get(line.category.per)
        if group is None or getattr(line, "maximum", None) is None:
            continue  # "par dépense" (déjà vérifié par la ligne), ou pas de plafond pour ce grade
        key = group(line)
        before = used.get(key, Decimal("0"))
        used[key] = before + line.amount
        line.ceiling = max(line.maximum - before, Decimal("0"))  # ce qui restait pour cette ligne
        try:
            line.check_above(f"Maximum {line.category} ({line.category.get_per_display()}) pour votre grade : "
                             f"{line.maximum:.2f} MAD (total {WHAT[line.category.per]} : {used[key]:.2f} MAD)")
        except ValidationError as problem:
            errors[index] = problem.messages[0]
    return errors


@transaction.atomic
def submit_claim(employee, title, lines):
    """Envoie une note de frais. `lines` : [{"date", "category", "amount", "description", "receipts"}, ...]
    (receipts : les fichiers envoyés pour cette dépense, de 0 à MAX_RECEIPTS).
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
        files = list(data.get("receipts") or [])
        # Une autre devise (2026-11-16) : le montant tapé est celui du REÇU (ex. 20 EUR) ; on le convertit en MAD avec
        # le taux du jour (gardé sur la ligne) : le plafond, le total et le remboursement sont en MAD.
        amount, currency, original, rate = data.get("amount"), data.get("currency"), None, None
        if currency is not None and currency.name.upper() != "MAD":
            if not currency.is_active:
                errors[f"line_{index}"] = [f"La devise {currency} n'est plus proposée."]
                continue
            original, rate = amount, currency.rate_to_mad
            amount = (original * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if original is not None else None
        else:
            currency = None  # payée en MAD : rien à convertir
        line = ExpenseLine(
            claim=claim, date=data.get("date"), category=data.get("category"), amount=amount,
            currency=currency, original_amount=original, rate=rate,
            description=(data.get("description") or "").strip(),
            justification=data.get("justification") or "",  # seulement si la dépense dépasse son plafond
        )
        messages = []
        try:
            line.full_clean(exclude=["claim"])  # les règles de la ligne (date, plafond...)
        except ValidationError as problem:
            messages += problem.messages
        try:
            line.check_receipts(files)  # ses justificatifs (obligatoire ?, combien, format, taille)
        except ValidationError as problem:
            messages += problem.messages
        if messages:
            errors[f"line_{index}"] = messages
        built.append((line, files))
    # Les maximums "par jour / par nuit / par trajet" : le TOTAL des lignes d'une catégorie (le même jour, ou toute la
    # mission), pas chaque ligne seule (2026-11-18).
    for index, message in check_maximums([(index, line) for index, (line, _) in enumerate(built)
                                          if f"line_{index}" not in errors]).items():
        errors.setdefault(f"line_{index}", []).append(message)
    if errors:
        raise ValidationError(errors)

    claim.total = sum(line.amount for line, _ in built)
    # Une dépense au-dessus du plafond : le titre le dit, donc le N+1 le voit dès la cloche / Team approvals.
    above = " · au-dessus du plafond" if any(line.above_ceiling for line, _ in built) else ""
    claim.request = engine.submit(Workflow.Code.EXPENSE, employee, f"Note de frais : {title} ({money(claim.total)} MAD){above}")
    # (Après une correction, le titre est refait par claim_title : la même forme.)
    claim.save()
    for line, files in built:
        line.claim = claim
        line.save()
        for file in files:  # chaque fichier est écrit dans media/receipts/... à ce moment-là
            ExpenseReceipt.objects.create(line=line, file=file, name=file.name[:200])
    return claim


def claim_title(claim):
    """Le titre de la demande : "Note de frais : Mission Agadir (500,00 MAD)" (+ "· au-dessus du plafond").
    Refait après une correction : le total a changé (la cloche, Team approvals, My requests le montrent)."""
    above = " · au-dessus du plafond" if any(line.above_ceiling for line in claim.lines.all()) else ""
    return f"Note de frais : {claim.title} ({money(claim.total)} MAD){above}"


def correction_role(user, claim):
    """À quel titre CET utilisateur peut corriger cette note MAINTENANT : "N+1" / "N+2" / "DG" / "RH", ou None.
    Il faut que la note attende SA réponse (l'étape VALIDATE en cours, `engine.can_decide`) ET que le réglage
    d'Admin RH le permette (N+1 et RH / RH seulement / personne)."""
    request = claim.request
    if request.status != Request.Status.IN_PROGRESS:
        return None
    step = request.steps.filter(status="PENDING").select_related("assignee", "request__requester").first()
    if step is None or step.mode != WorkflowStep.Mode.VALIDATE or not engine.can_decide(user, step):
        return None
    who = ExpenseSettings.load().who_can_correct
    hr_step = step.approver == WorkflowStep.Approver.HR
    if who == ExpenseSettings.Correctors.NOBODY or (who == ExpenseSettings.Correctors.HR_ONLY and not hr_step):
        return None
    return "RH" if hr_step else step.get_approver_display()


@transaction.atomic
def correct_line(line, user, new_amount, reason):
    """Un valideur DIMINUE le montant d'une dépense (jamais plus haut ; 0 = la dépense est refusée), avec un motif.
    La trace (ExpenseCorrection), le nouveau total, le titre refait, et une 🔔 + email au collaborateur."""
    claim = ExpenseClaim.objects.select_for_update().select_related("request", "employee").get(pk=line.claim_id)
    line = ExpenseLine.objects.select_related("category").get(pk=line.pk)
    role = correction_role(user, claim)
    if role is None:
        raise PermissionDenied("Vous ne pouvez pas corriger cette note maintenant (ce n'est pas à vous de répondre, "
                               "ou Admin RH ne permet pas la correction à votre étape).")
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError({"reason": ["Donnez le motif de la correction (ex. « Le reçu indique 150 MAD »)."]})
    if new_amount is None or new_amount < 0:
        raise ValidationError({"amount": ["Le nouveau montant ne peut pas être négatif."]})
    if new_amount >= line.amount:
        # Standard : le valideur DIMINUE seulement ; un oubli du collaborateur = une nouvelle note.
        raise ValidationError({"amount": [f"Le nouveau montant doit être plus petit que {money(line.amount)} MAD "
                                          "(on ne peut que diminuer)."]})
    ExpenseCorrection.objects.create(line=line, old_amount=line.amount, new_amount=new_amount, reason=reason[:300],
                                     corrected_by=user, as_role=role)
    line.amount = new_amount
    line.save(update_fields=["amount"])
    claim.total = sum(other.amount for other in claim.lines.all())
    claim.save(update_fields=["total"])
    claim.request.title = claim_title(claim)
    claim.request.save(update_fields=["title"])
    Notification.objects.create(recipient=claim.employee.user, employee=claim.employee,
                                kind=Notification.Kind.EXPENSE_CORRECTED, request=claim.request)
    return line


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
