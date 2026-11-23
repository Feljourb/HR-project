"""L'API des notes de frais (/api/expenses/).

GET  categories/                      -> les catégories actives (le formulaire), avec le plafond de MON grade
GET / POST ceilings/                  -> le tableau des plafonds (catégorie x grade) : Admin RH (2026-11-18)
GET  mine/                            -> mes notes de frais
POST mine/                            -> envoyer une note (multipart : title, lines = JSON, et les fichiers de la
                                         dépense n° i sous le nom receipt_<i>, une ou plusieurs fois)
GET  mine/ceilings/                   -> mon grade et mes plafonds (la carte "My ceilings")
GET  claims/<request>/                -> une note (pour ceux que la demande concerne : moi, mon N+1, les RH...)
GET  claims/<request>/pdf/            -> son PDF, une fois validée (à imprimer pour les RH)
GET  receipts/<id>/                   -> un justificatif d'une dépense (mêmes droits que la note)
GET  hr/?status=to_reimburse|reimbursed|in_progress|all -> les notes du pôle (RH)
POST hr/<request>/reimburse/          -> la marquer remboursée (RH)
POST lines/<id>/correct/              -> {amount, reason} : le valideur diminue un montant (2026-11-16) ; répond la note
GET / PATCH settings/                 -> {who_can_correct} : Admin RH (et l'IT)
Annuler : /api/workflows/requests/<request>/cancel/ (le moteur, comme pour toutes les demandes).
"""
import json
from decimal import Decimal, InvalidOperation

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse, HttpResponse
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsHR, IsHRAdmin
from employees.models import Employee, Grade
from employees.services import limited_to_own_pole, user_pole
from workflows import engine
from workflows.models import Request

from .models import (MAX_LINE_AMOUNT, CategoryCeiling, Currency, ExpenseCategory, ExpenseClaim, ExpenseLine, ExpenseReceipt,
                     ExpenseSettings)
from .pdf import claim_pdf
from .serializers import (CategorySerializer, ClaimSerializer, CorrectInputSerializer, CurrencySerializer,
                          ExpenseSettingsSerializer, LineInputSerializer)
from .services import correct_line, mark_reimbursed, submit_claim


def run(action):
    """Les erreurs des services -> des réponses claires. Une erreur PAR CHAMP / PAR LIGNE reste rangée
    ({"line_0": ["Plafond..."]}) : le formulaire affiche chaque message sous sa ligne."""
    try:
        return action()
    except DjangoValidationError as error:
        raise serializers.ValidationError(error.message_dict if hasattr(error, "error_dict") else {"detail": error.messages[0]})
    except DjangoPermissionDenied as error:
        raise PermissionDenied(str(error))


def claims():
    """Les notes avec tout ce que le JSON lit, en peu de requêtes SQL."""
    return (ExpenseClaim.objects
            .select_related("request", "employee__department__direction__entity__pole", "employee__grade", "reimbursed_by")
            .prefetch_related("lines__category", "lines__currency", "lines__receipts", "lines__corrections__corrected_by", "request__steps__assignee"))


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    """Les catégories actives du formulaire, chacune avec le plafond de MON grade ("my_ceiling", 2026-11-18)."""
    queryset = ExpenseCategory.objects.filter(is_active=True).prefetch_related("ceilings")
    serializer_class = CategorySerializer

    def get_serializer_context(self):
        employee = Employee.objects.filter(user=self.request.user).only("grade_id").first()
        return {**super().get_serializer_context(), "grade": employee.grade_id if employee else None}


class CeilingsView(APIView):
    """Le tableau des plafonds d'Admin RH (2026-11-18) : une ligne par catégorie, une colonne par grade.
    GET  ceilings/ -> {"grades": [{id, name}], "ceilings": [{category, grade, amount}]}
    POST ceilings/ {"category", "grade", "amount"} -> met ce plafond (amount vide ou null : l'enlève = pas de plafond)."""

    def get_permissions(self):
        # LIRE : tout le monde ("See all grades" sous "My ceilings", 2026-11-18) ; CHANGER : Admin RH seulement.
        return [IsAuthenticated()] if self.request.method == "GET" else [IsHRAdmin()]

    def get(self, request):
        grades = Grade.objects.filter(is_active=True).order_by("name")
        rows = CategoryCeiling.objects.all()
        categories = ExpenseCategory.objects.filter(is_active=True).order_by("name")
        return Response({"grades": [{"id": grade.pk, "name": grade.name} for grade in grades],
                         "categories": [{"id": category.pk, "name": category.name, "per": category.get_per_display()}
                                        for category in categories],
                         "ceilings": [{"category": row.category_id, "grade": row.grade_id, "amount": float(row.amount)} for row in rows]})

    def post(self, request):
        category = ExpenseCategory.objects.filter(pk=request.data.get("category")).first()
        grade = Grade.objects.filter(pk=request.data.get("grade")).first()
        if category is None or grade is None:
            raise serializers.ValidationError({"detail": "Catégorie ou grade introuvable."})
        raw = request.data.get("amount")
        if raw in (None, ""):
            CategoryCeiling.objects.filter(category=category, grade=grade).delete()  # pas de plafond pour ce grade
            return Response({"category": category.pk, "grade": grade.pk, "amount": None})
        try:
            amount = Decimal(str(raw)).quantize(Decimal("0.01"))
        except InvalidOperation:
            raise serializers.ValidationError({"detail": "Montant illisible."})
        if amount <= 0 or amount > MAX_LINE_AMOUNT:
            raise serializers.ValidationError({"detail": "Le plafond doit être entre 0,01 et 100 000 MAD."})
        CategoryCeiling.objects.update_or_create(category=category, grade=grade, defaults={"amount": amount})
        return Response({"category": category.pk, "grade": grade.pk, "amount": float(amount)})


class CurrencyViewSet(viewsets.ReadOnlyModelViewSet):
    """Les devises actives et leur taux du jour (le formulaire : la liste à côté du montant, MAD par défaut)."""
    queryset = Currency.objects.filter(is_active=True).order_by("name")
    serializer_class = CurrencySerializer


def my_employee(user):
    employee = Employee.objects.filter(user=user).select_related("grade").first()
    if employee is None:
        raise NotFound("Aucun dossier RH n'est lié à ce compte.")
    return employee


class MyClaimViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = ClaimSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # multipart : les justificatifs sont des fichiers

    def get_queryset(self):
        return claims().filter(employee__user=self.request.user)

    def create(self, request):
        employee = my_employee(request.user)
        # Les lignes arrivent en JSON (texte) dans le formulaire multipart ; les fichiers à côté : receipt_<n°>,
        # répété pour chaque justificatif de la même dépense (getlist).
        try:
            raw_lines = json.loads(request.data.get("lines") or "[]")
        except json.JSONDecodeError:
            raise serializers.ValidationError({"lines": ["Lignes illisibles."]})
        if not isinstance(raw_lines, list):
            raise serializers.ValidationError({"lines": ["Lignes illisibles."]})

        lines, errors = [], {}
        for index, raw in enumerate(raw_lines):
            data = LineInputSerializer(data=raw if isinstance(raw, dict) else {})
            if data.is_valid():
                lines.append({**data.validated_data, "receipts": request.FILES.getlist(f"receipt_{index}")})
            else:
                # Un champ mal rempli (ex. une date vide) : son message, sous sa ligne.
                errors[f"line_{index}"] = [f"{name} : {messages[0]}" for name, messages in data.errors.items()]
        if errors:
            raise serializers.ValidationError(errors)

        claim = run(lambda: submit_claim(employee, request.data.get("title"), lines))
        return Response(ClaimSerializer(claims().get(pk=claim.pk)).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def ceilings(self, request):
        """Mon grade et MES plafonds (la carte "My ceilings") : {"grade": "Grade E — Employé" ou null,
        "ceilings": [{"category": "Hébergement (hôtel)", "per": "par nuit", "amount": 400}, ...]}.
        Toujours un objet JSON (bug du 2026-11-03 : une réponse vide bloquait la page d'un compte sans grade)."""
        employee = my_employee(request.user)
        rows = (CategoryCeiling.objects.filter(grade=employee.grade_id, category__is_active=True).select_related("category")
                .order_by("category__name")) if employee.grade_id else []
        return Response({"grade": str(employee.grade) if employee.grade_id else None,
                         "ceilings": [{"category": row.category.name, "per": row.category.get_per_display(), "amount": float(row.amount)}
                                      for row in rows]})


class ClaimViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Une note, par le numéro de SA DEMANDE (/claims/<request>/), pour ceux que la demande concerne :
    le demandeur, ses valideurs, les RH du pôle, Admin RH, IT (la même règle que l'historique ; sinon 404)."""

    serializer_class = ClaimSerializer
    lookup_field = "request"
    lookup_url_kwarg = "request_id"  # pas "request" dans l'adresse : ce nom est déjà le 1er argument des méthodes

    def get_queryset(self):
        return claims().filter(request__in=engine.requests_visible_to(self.request.user))

    @action(detail=True, methods=["get"])
    def pdf(self, request, request_id=None):
        claim = self.get_object()
        if claim.request.status != Request.Status.APPROVED:
            raise serializers.ValidationError({"detail": "Le PDF est disponible après la validation de la note."})
        response = HttpResponse(claim_pdf(claim), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="note-de-frais-{claim.request_id}.pdf"'
        return response


class ReceiptViewSet(viewsets.GenericViewSet):
    """GET receipts/<id>/ -> un justificatif : mêmes droits que la note (sinon 404, comme s'il n'existait pas)."""

    def get_queryset(self):
        return ExpenseReceipt.objects.filter(line__claim__request__in=engine.requests_visible_to(self.request.user))

    def retrieve(self, request, pk=None):
        receipt = self.get_object()
        return FileResponse(receipt.file.open("rb"), as_attachment=False, filename=receipt.name or receipt.file.name)


class LineViewSet(viewsets.GenericViewSet):
    """POST lines/<id>/correct/ {amount, reason} : le valideur qui doit répondre DIMINUE le montant d'une dépense
    (si Admin RH le permet à son étape). Seulement les dépenses des notes qu'il voit (sinon 404)."""

    def get_queryset(self):
        return ExpenseLine.objects.filter(claim__request__in=engine.requests_visible_to(self.request.user))

    @action(detail=True, methods=["post"])
    def correct(self, request, pk=None):
        line = self.get_object()
        data = CorrectInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        run(lambda: correct_line(line, request.user, data.validated_data["amount"], data.validated_data["reason"]))
        claim = claims().get(pk=line.claim_id)
        return Response(ClaimSerializer(claim, context={"request": request}).data)


class ExpenseSettingsView(APIView):
    """Les réglages des notes de frais (page Reference lists -> Expenses), Admin RH et l'IT seulement."""

    permission_classes = [IsHRAdmin]

    def get(self, request):
        return Response(ExpenseSettingsSerializer(ExpenseSettings.load()).data)

    def patch(self, request):
        data = ExpenseSettingsSerializer(ExpenseSettings.load(), data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        data.save(updated_by=request.user)
        return Response(data.data)


class HrClaimViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Les notes de frais du pôle (RH ; Admin RH et IT : les deux pôles), pour les rembourser."""

    serializer_class = ClaimSerializer
    permission_classes = [IsHR]
    lookup_field = "request"
    lookup_url_kwarg = "request_id"

    FILTERS = {
        "to_reimburse": {"request__status": Request.Status.APPROVED, "reimbursed_at__isnull": True},
        "reimbursed": {"reimbursed_at__isnull": False},
        "in_progress": {"request__status": Request.Status.IN_PROGRESS},
    }

    def get_queryset(self):
        queryset = claims()
        user = self.request.user
        if limited_to_own_pole(user):
            pole = user_pole(user)
            queryset = queryset.filter(employee__department__direction__entity__pole=pole) if pole else queryset.none()
        if self.action == "list":
            queryset = queryset.filter(**self.FILTERS.get(self.request.query_params.get("status"), {}))
        return queryset

    @action(detail=True, methods=["post"])
    def reimburse(self, request, request_id=None):
        claim = self.get_object()
        run(lambda: mark_reimbursed(claim, request.user))
        return Response(ClaimSerializer(claims().get(pk=claim.pk)).data)
