"""API de l'app employees : les listes de référence (step 4) et les collaborateurs (step 5).

LISTES : une adresse par liste, ex. /api/employees/lists/positions/ :
  GET   .../positions/                  -> la liste (seulement les valeurs actives)
  GET   .../positions/?department=4     -> filtre en cascade : les postes du service 4
  GET   .../positions/?all=1            -> Admin RH : aussi les valeurs désactivées
  POST  .../positions/                  -> Admin RH : ajouter une valeur
  PATCH .../positions/12/               -> Admin RH : renommer, ou désactiver (is_active=false)
Pas de DELETE : une valeur n'est jamais supprimée, seulement désactivée.

COLLABORATEURS : /api/employees/
  GET   /api/employees/?search=alami&status=ACTIVE&entity=2&page=1  -> le tableau (RH)
  POST  /api/employees/        -> RH : créer un dossier (+ son compte prénom.nom / CIN)
  GET   /api/employees/7/      -> RH : un dossier complet
  PATCH /api/employees/7/      -> RH : modifier un dossier
  POST  /api/employees/7/reset-password/ -> RH : mot de passe temporaire (mot de passe oublié)
  GET   /api/employees/me/     -> tout le monde : MON dossier
  PATCH /api/employees/me/     -> tout le monde : modifier MES infos personnelles
"""
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from accounts.permissions import AccountReady, IsHR, IsHRAdmin
from accounts.services import can_reset_password, reset_password as reset_account_password

from .models import (
    Assignment, Bank, Category, ContractType, CostCenter, Department, Direction, Division,
    Employee, Entity, Grade, Pole, Position, Region, TempAgency,
)
from .serializers import EmployeeListSerializer, EmployeeSerializer, MyFicheSerializer, ReferenceSerializer
from .services import limited_to_own_pole, sees_both_poles, user_pole


def id_param(params, name):
    """Lit un filtre numérique de l'adresse (ex. ?entity=3).
    "abc" ferait planter la requête SQL : on renvoie une erreur 400 claire à la place."""
    value = params.get(name)
    if value and not value.isdigit():
        raise ValidationError({name: "Identifiant invalide."})
    return value


class ReferenceViewSet(viewsets.ModelViewSet):
    """Le comportement commun à toutes les listes. Chaque liste est une copie de
    cette classe avec son modèle et ses réglages (voir make_viewset plus bas)."""

    # Méthodes HTTP autorisées : pas de "delete" ni "put" (PATCH suffit pour modifier).
    http_method_names = ["get", "post", "patch", "head", "options"]
    # Champ parent pour le filtre en cascade (ex. "department" pour les postes), ou None.
    parent_field = None
    # Chemin du modèle vers son pôle (ex. "entity__pole" pour une direction), ou None
    # si la liste ne dépend pas du pôle (banques, régions...).
    pole_path = None

    def get_permissions(self):
        # Lire (GET) : la permission par défaut du projet (connecté + compte prêt).
        if self.request.method in SAFE_METHODS:
            return super().get_permissions()
        # Ajouter / modifier : Admin RH seulement (et l'IT, qui a toujours accès).
        return [IsHRAdmin()]

    def get_queryset(self):
        """Les valeurs que cet utilisateur a le droit de voir."""
        queryset = super().get_queryset()
        user = self.request.user
        params = self.request.query_params

        # 1. Dans la liste, seulement les valeurs actives : un formulaire ne doit pas
        #    proposer une valeur désactivée. ?all=1 montre tout, mais seulement pour
        #    Admin RH / IT (ils gèrent les listes et doivent pouvoir réactiver une valeur).
        if self.action == "list" and not (sees_both_poles(user) and params.get("all") == "1"):
            queryset = queryset.filter(is_active=True)

        # 2. Filtre en cascade : ?entity=3 -> seulement les directions de l'entité 3.
        value = id_param(params, self.parent_field) if self.parent_field else None
        if value:
            queryset = queryset.filter(**{self.parent_field: value})

        # 3. Un RH ne voit que l'organisation de son pôle (RH SBD -> entités de SBD).
        #    Admin RH, IT, managers et collaborateurs voient les deux pôles.
        if self.pole_path and limited_to_own_pole(user):
            pole = user_pole(user)
            # Un RH sans dossier n'a pas de pôle : il ne voit rien (plus sûr que tout montrer).
            # pole.pk (le numéro) marche pour tous les chemins, même "pk" de la liste des pôles.
            queryset = queryset.filter(**{self.pole_path: pole.pk}) if pole else queryset.none()

        return queryset


def make_viewset(model, parent_field=None, pole_path=None):
    """Fabrique la vue d'une liste à partir de son modèle, pour ne pas écrire
    14 fois les mêmes classes. type(nom, (classe_mère,), attributs) crée une classe,
    exactement comme si on l'écrivait avec "class ...:"."""
    # Le serializer de cette liste : tous les champs du modèle (id, name, is_active,
    # + le parent ex. "department", + "code" pour les centres de coût).
    meta = type("Meta", (), {"model": model, "fields": "__all__"})
    serializer = type(f"{model.__name__}Serializer", (ReferenceSerializer,), {"Meta": meta})
    return type(f"{model.__name__}ViewSet", (ReferenceViewSet,), {
        "queryset": model.objects.all(),
        "serializer_class": serializer,
        "parent_field": parent_field,
        "pole_path": pole_path,
    })


# Toutes les listes : morceau d'adresse -> vue. Utilisé par urls.py.
LIST_VIEWSETS = {
    # Organisation : chaque niveau se filtre par son parent, et dépend du pôle.
    "poles": make_viewset(Pole, pole_path="pk"),
    "entities": make_viewset(Entity, parent_field="pole", pole_path="pole"),
    "directions": make_viewset(Direction, parent_field="entity", pole_path="entity__pole"),
    "departments": make_viewset(Department, parent_field="direction", pole_path="direction__entity__pole"),
    "positions": make_viewset(Position, parent_field="department", pole_path="department__direction__entity__pole"),
    # Listes simples : les mêmes pour tout le monde.
    "divisions": make_viewset(Division),
    "assignments": make_viewset(Assignment),
    "categories": make_viewset(Category),
    "contract-types": make_viewset(ContractType),
    "temp-agencies": make_viewset(TempAgency),
    "grades": make_viewset(Grade),
    "regions": make_viewset(Region),
    "cost-centers": make_viewset(CostCenter),
    "banks": make_viewset(Bank),
}


# --- Collaborateurs (step 5) -----------------------------------------------------

class EmployeePagination(PageNumberPagination):
    """Le tableau est envoyé par pages de 25 (?page=2...), pas 1000 lignes d'un coup.
    Réponse : {"count": total, "next": ..., "previous": ..., "results": [...]}."""
    page_size = 25
    page_size_query_param = "page_size"  # le frontend peut demander ?page_size=50
    max_page_size = 100


class EmployeeViewSet(viewsets.ModelViewSet):
    """Les dossiers des collaborateurs, réservés aux RH (IsHR = Admin RH + RH, et l'IT)."""

    permission_classes = [IsHR]
    http_method_names = ["get", "post", "patch", "head", "options"]  # pas de suppression : statut "Sorti"
    pagination_class = EmployeePagination
    lookup_value_regex = r"\d+"  # /api/employees/7/ : seulement des numéros (sinon "me" serait pris pour un id)

    def get_serializer_class(self):
        # Le tableau a besoin de peu de champs ; le dossier, de tous.
        if self.action == "list":
            return EmployeeListSerializer
        if self.action == "me":
            return MyFicheSerializer
        return EmployeeSerializer

    def get_queryset(self):
        """Les dossiers que cet utilisateur a le droit de voir."""
        # select_related : charge service, direction, entité... dans la même requête SQL
        # (sinon le tableau ferait plusieurs requêtes par ligne).
        queryset = Employee.objects.select_related(
            "user", "position", "contract_type", "department__direction__entity__pole",
        )

        # Un RH ne voit que les collaborateurs de son pôle. Sans dossier (donc sans pôle) : rien.
        # Les autres (Admin RH, IT) voient tout. Pour un autre dossier, la réponse est 404 :
        # on ne dit même pas qu'il existe.
        user = self.request.user
        if limited_to_own_pole(user):
            pole = user_pole(user)
            queryset = queryset.filter(department__direction__entity__pole=pole.pk) if pole else queryset.none()

        # Recherche et filtres du tableau (seulement pour la liste).
        if self.action == "list":
            params = self.request.query_params
            if search := params.get("search", "").strip():
                # Q(...) | Q(...) : "OU" entre plusieurs conditions ; icontains : contient, sans majuscules.
                queryset = queryset.filter(
                    Q(last_name__icontains=search) | Q(first_name__icontains=search)
                    | Q(cin__icontains=search) | Q(u_number__icontains=search)
                )
            if status := params.get("status"):
                queryset = queryset.filter(status=status)
            if entity := id_param(params, "entity"):
                queryset = queryset.filter(department__direction__entity=entity)
        return queryset

    # detail=True : adresse avec id (/api/employees/7/reset-password/).
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """Le collaborateur a oublié son mot de passe : on lui en donne un temporaire.

        - get_object() utilise get_queryset() : un RH ne trouve que son pôle (sinon 404).
        - can_reset_password : un RH ne réinitialise pas un RH / Admin RH, personne sauf l'IT
          ne touche un compte IT (403).
        - Le mot de passe est renvoyé UNE fois : le RH le transmet, la base n'en garde que le hash.
        """
        employee = self.get_object()
        if not can_reset_password(request.user, employee.user):
            raise PermissionDenied("Vous ne pouvez pas réinitialiser le mot de passe de ce compte.")
        password = reset_account_password(employee.user)
        response = Response({"username": employee.user.username, "temporary_password": password})
        # no-store : le navigateur (ou un proxy) ne doit garder aucune copie de cette réponse.
        response["Cache-Control"] = "no-store"
        return response

    # detail=False : adresse sans id (/api/employees/me/). AccountReady : tous les rôles,
    # pas seulement les RH (chaque collaborateur voit son propre dossier).
    @action(detail=False, methods=["get", "patch"], permission_classes=[AccountReady])
    def me(self, request):
        """MON dossier. En PATCH, seuls les champs personnels changent (voir MyFicheSerializer)."""
        employee = Employee.objects.filter(user=request.user).first()
        if employee is None:
            raise NotFound("Aucun dossier RH n'est lié à ce compte.")
        if request.method == "GET":
            return Response(self.get_serializer(employee).data)
        serializer = self.get_serializer(employee, data=request.data, partial=True)  # partial : PATCH
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
