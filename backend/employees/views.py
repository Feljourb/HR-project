"""API de l'app employees : les listes de référence (step 4) et les collaborateurs (step 5).

LISTES : une adresse par liste, ex. /api/employees/lists/positions/ :
  GET   .../positions/                  -> la liste (seulement les valeurs actives)
  GET   .../positions/?department=4     -> filtre en cascade : les postes du service 4
  GET   .../positions/?all=1            -> Admin RH : aussi les valeurs désactivées
  GET   .../positions/?include=12       -> les actives + la valeur 12 (celle du dossier qu'on modifie)
  POST  .../positions/                  -> Admin RH : ajouter une valeur
  PATCH .../positions/12/               -> Admin RH : renommer, ou désactiver (is_active=false)
Pas de DELETE (décision de l'encadrant) : une valeur n'est jamais supprimée, seulement désactivée.

COLLABORATEURS : /api/employees/
  GET   /api/employees/?search=alami&status=ACTIVE&entity=2&page=1  -> le tableau (RH)
  POST  /api/employees/        -> RH : créer un dossier (+ son compte prénom.nom / CIN)
  GET   /api/employees/7/      -> RH : un dossier complet
  PATCH /api/employees/7/      -> RH : modifier un dossier
  POST  /api/employees/7/reset-password/ -> RH : mot de passe temporaire (mot de passe oublié)
  GET   /api/employees/7/history/  -> RH : l'historique du dossier (qui a changé quoi, quand)
  GET   /api/employees/history/?search=&actor=&action=&date_from=&date_to= -> RH : le journal de tous les dossiers
  GET   /api/employees/directory/?search=karim&direction=3&department=7&page=1 -> tout le monde : l'annuaire (champs publics)
  GET   /api/employees/directory/filters/ -> tout le monde : les directions et services des filtres de l'annuaire
  GET   /api/employees/me/     -> tout le monde : MON dossier
  PATCH /api/employees/me/     -> tout le monde : modifier MES infos personnelles
"""
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from accounts.permissions import AccountReady, IsHR, IsHRAdmin
from accounts.services import can_reset_password, reset_password as reset_account_password

from . import history, notifications
from .models import (
    Assignment, Bank, Category, City, ContractType, CostCenter, Department, Direction, Division,
    Employee, EmployeeHistory, Entity, Grade, Notification, Pole, Position, Region, TempAgency,
)
from .serializers import (
    AuditLogSerializer, DirectorySerializer, EmployeeListSerializer, EmployeeSerializer, HistorySerializer,
    MyFicheSerializer, NotificationSerializer, ReferenceSerializer, hierarchy_data,
)
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

    # Méthodes HTTP autorisées : pas de "delete" (on désactive) ni "put" (PATCH suffit pour modifier).
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

    # Directions et services : changer le responsable change le N+1 de toute l'équipe,
    # donc on le note dans l'historique (Audit log). Les autres listes n'ont pas de responsable.
    # atomic : le changement et sa ligne d'historique sont enregistrés ensemble, ou pas du tout.
    @transaction.atomic
    def perform_create(self, serializer):
        unit = serializer.save()
        if hasattr(unit, "head"):
            history.record_head(unit, self.request.user, None, unit.head)

    @transaction.atomic
    def perform_update(self, serializer):
        old_head = getattr(serializer.instance, "head", None)  # AVANT l'enregistrement
        unit = serializer.save()
        if hasattr(unit, "head"):
            history.record_head(unit, self.request.user, old_head, unit.head)

    def get_queryset(self):
        """Les valeurs que cet utilisateur a le droit de voir."""
        queryset = super().get_queryset()
        user = self.request.user
        params = self.request.query_params

        # 1. Dans la liste, seulement les valeurs actives : un formulaire ne doit pas
        #    proposer une valeur désactivée. ?all=1 montre tout, mais seulement pour
        #    Admin RH / IT (ils gèrent les listes et doivent pouvoir réactiver une valeur).
        #    ?include=12 : la valeur 12 aussi, même désactivée. C'est la valeur ACTUELLE du dossier
        #    qu'on modifie : sans elle, la liste déroulante ne pourrait pas l'afficher, et le RH
        #    devrait en choisir une autre. (Le filtre en cascade et le pôle s'appliquent quand même.)
        if self.action == "list" and not (sees_both_poles(user) and params.get("all") == "1"):
            include = id_param(params, "include")
            queryset = queryset.filter(Q(is_active=True) | Q(pk=include)) if include else queryset.filter(is_active=True)

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


def make_viewset(model, parent_field=None, pole_path=None, exclude=()):
    """Fabrique la vue d'une liste à partir de son modèle, pour ne pas écrire
    14 fois les mêmes classes. type(nom, (classe_mère,), attributs) crée une classe,
    exactement comme si on l'écrivait avec "class ...:"."""
    # Le serializer de cette liste : tous les champs du modèle (id, name, is_active,
    # + le parent ex. "department", + "code" pour les centres de coût), sauf `exclude`.
    meta = type("Meta", (), {"model": model, "exclude": exclude} if exclude else {"model": model, "fields": "__all__"})
    attributes = {"Meta": meta}
    # Directions et services : le responsable ("head" = un id) + son nom, pour l'afficher dans la page Listes.
    if any(field.name == "head" for field in model._meta.fields):
        attributes["head_label"] = serializers.StringRelatedField(source="head", read_only=True)
    serializer = type(f"{model.__name__}Serializer", (ReferenceSerializer,), attributes)
    return type(f"{model.__name__}ViewSet", (ReferenceViewSet,), {
        "queryset": model.objects.all(),
        "serializer_class": serializer,
        "parent_field": parent_field,
        "pole_path": pole_path,
    })


# Toutes les listes : morceau d'adresse -> vue. Utilisé par urls.py.
LIST_VIEWSETS = {
    # Organisation : chaque niveau se filtre par son parent, et dépend du pôle.
    # Sans le DG : il se choisit dans l'écran "Workflows" (app workflows), pas dans les listes.
    "poles": make_viewset(Pole, pole_path="pk", exclude=["director"]),
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
    "cities": make_viewset(City),
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
            # Choisir le responsable d'un service / d'une direction : seulement les gens qui y travaillent.
            if department := id_param(params, "department"):
                queryset = queryset.filter(department=department)
            if direction := id_param(params, "direction"):
                queryset = queryset.filter(department__direction=direction)
        return queryset

    @action(detail=False, methods=["get"], url_path="hierarchy-preview", url_name="hierarchy-preview")
    def hierarchy_preview(self, request):
        """La chaîne N+1 -> DG PENDANT la saisie du formulaire, avant d'enregistrer :
        /api/employees/hierarchy-preview/?department=4[&employee=12]
        - department : le service choisi ;
        - employee : en modification, le dossier lui-même (pour savoir s'il est responsable ou DG).
        On construit un dossier "brouillon" (jamais enregistré) et on lui demande sa hiérarchie :
        la même règle que la fiche enregistrée (Employee.n_plus_1), jamais une deuxième règle."""
        params = request.query_params
        department = Department.objects.filter(pk=id_param(params, "department")).first()
        if department is None:
            return Response([])  # pas encore de service : rien à calculer
        draft = Employee(department=department)
        # Seulement un dossier que ce RH a le droit de voir (sinon : un nouveau dossier, sans id).
        draft.pk = self.get_queryset().filter(pk=id_param(params, "employee")).values_list("pk", flat=True).first()
        return Response(hierarchy_data(draft))

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
        history.record(employee, request.user, EmployeeHistory.Action.PASSWORD_RESET)  # jamais le mot de passe
        response = Response({"username": employee.user.username, "temporary_password": password})
        # no-store : le navigateur (ou un proxy) ne doit garder aucune copie de cette réponse.
        response["Cache-Control"] = "no-store"
        return response

    def visible_history(self, entries):
        """Ce que l'IT fait (support technique) n'apparaît pas dans l'historique des RH (décision du
        2026-11-01) : les lignes restent en base, visibles dans /admin et par l'IT lui-même."""
        if self.request.user.is_superuser:
            return entries
        return entries.exclude(actor__is_superuser=True)

    # Méthode "file_history" (pas "history" : c'est déjà le nom du module employees/history.py).
    @action(detail=True, methods=["get"], url_path="history", url_name="history")
    def file_history(self, request, pk=None):
        """L'historique du dossier, le plus récent d'abord, par pages de 25.
        get_object() : un RH ne voit que l'historique des dossiers de son pôle (sinon 404)."""
        employee = self.get_object()
        page = self.paginate_queryset(self.visible_history(employee.history.all()))
        return self.get_paginated_response(HistorySerializer(page, many=True).data)

    @action(detail=False, methods=["get"], url_path="history", url_name="audit-log")
    def audit_log(self, request):
        """Le journal de TOUS les dossiers (page "Audit log"), le plus récent d'abord, par pages de 25.

        Filtres : ?search=alami (collaborateur : nom, prénom, matricule), ?actor=rh.alami (qui),
        ?action=ROLE, ?date_from=2026-10-01&date_to=2026-10-31.
        Un RH ne voit que les dossiers de son pôle : on part de get_queryset() (le même filtre que le tableau).
        """
        params = request.query_params
        entries = self.visible_history(EmployeeHistory.objects.filter(employee__in=self.get_queryset())).select_related("employee")

        if search := params.get("search", "").strip():
            entries = entries.filter(
                Q(employee__last_name__icontains=search) | Q(employee__first_name__icontains=search)
                | Q(employee__u_number__icontains=search)
            )
        if actor := params.get("actor", "").strip():
            entries = entries.filter(actor_name__icontains=actor)
        if action_name := params.get("action"):
            if action_name not in EmployeeHistory.Action.values:
                raise ValidationError({"action": "Action inconnue."})
            entries = entries.filter(action=action_name)
        # Les dates : "2026-10-31" -> filtre sur le jour (la fin de journée est comprise).
        for name, lookup in (("date_from", "created_at__date__gte"), ("date_to", "created_at__date__lte")):
            if value := params.get(name):
                try:
                    day = parse_date(value)  # None si le format est faux, ValueError si la date n'existe pas
                except ValueError:
                    day = None
                if day is None:
                    raise ValidationError({name: "Date invalide (format AAAA-MM-JJ)."})
                entries = entries.filter(**{lookup: day})

        page = self.paginate_queryset(entries)
        return self.get_paginated_response(AuditLogSerializer(page, many=True).data)

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


# --- Notifications (la cloche) -------------------------------------------------------

class NotificationViewSet(viewsets.GenericViewSet):
    """La cloche 🔔 : MES notifications. Chacun ne voit que les siennes (get_queryset).

    GET  /api/employees/notifications/           -> {"unread": 2, "results": [les 20 dernières]}
    POST /api/employees/notifications/5/read/     -> la notification 5 est lue
    POST /api/employees/notifications/read-all/   -> toutes sont lues
    Permission par défaut (connecté + compte prêt) : tous les rôles (un collaborateur reçoit
    les réponses à ses demandes, un manager les demandes à valider...).
    """

    serializer_class = NotificationSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).select_related("employee", "request")

    def list(self, request):
        notifications.refresh_for(request.user)  # crée les nouvelles, enlève celles qui ne servent plus
        queryset = self.get_queryset()
        return Response({
            "unread": queryset.filter(read_at__isnull=True).count(),
            "results": self.get_serializer(queryset[:20], many=True).data,
        })

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()  # la notification d'un autre : 404
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=204)


# --- Annuaire ----------------------------------------------------------------------

class DirectoryViewSet(viewsets.ReadOnlyModelViewSet):
    """L'annuaire : retrouver un collègue (nom, poste, service, email, téléphone).

    - Tous les rôles (permission par défaut : connecté + compte prêt), pas seulement les RH.
    - Les DEUX pôles pour tout le monde : un collaborateur de SBD doit pouvoir joindre Riaya.
    - Seulement les champs publics (DirectorySerializer) : jamais le CIN ni l'adresse.
    - Les collaborateurs sortis (statut "Sorti") n'y sont plus.
    """

    serializer_class = DirectorySerializer
    pagination_class = EmployeePagination  # 25 par page, comme le tableau RH
    http_method_names = ["get", "head", "options"]  # lecture seule

    def get_queryset(self):
        queryset = (
            Employee.objects.exclude(status=Employee.Status.LEFT)
            .select_related("position", "department__direction")
            .order_by("last_name", "first_name", "id")  # A -> Z, comme un annuaire
        )
        params = self.request.query_params
        # Recherche : nom, prénom, poste, service ou direction (ex. "ventes" trouve tout le service).
        if search := params.get("search", "").strip():
            queryset = queryset.filter(
                Q(last_name__icontains=search) | Q(first_name__icontains=search)
                | Q(position__name__icontains=search) | Q(department__name__icontains=search)
                | Q(department__direction__name__icontains=search)
            )
        # Les filtres de la page (des ids choisis dans directory/filters/). Un id pas numérique : ignoré.
        if params.get("direction", "").isdigit():
            queryset = queryset.filter(department__direction_id=params["direction"])
        if params.get("department", "").isdigit():
            queryset = queryset.filter(department_id=params["department"])
        return queryset

    @action(detail=False, pagination_class=None)
    def filters(self, request):
        """GET /api/employees/directory/filters/ -> les choix des filtres : les directions ET leurs services
        où quelqu'un travaille (pas de filtre vide), avec l'entité pour les distinguer (deux "Direction
        Commerciale"), et le nombre de collègues. Rien de personnel : seulement l'organigramme."""
        directions = {}
        rows = (Employee.objects.exclude(status=Employee.Status.LEFT)
                .values("department_id", "department__name", "department__direction_id",
                        "department__direction__name", "department__direction__entity__name")
                .annotate(count=Count("id")).order_by())
        for row in rows:
            direction = directions.setdefault(row["department__direction_id"], {
                "id": row["department__direction_id"], "name": row["department__direction__name"],
                "entity": row["department__direction__entity__name"], "count": 0, "departments": [],
            })
            direction["count"] += row["count"]
            direction["departments"].append({"id": row["department_id"], "name": row["department__name"], "count": row["count"]})
        result = sorted(directions.values(), key=lambda item: (item["name"].lower(), item["entity"].lower()))
        for direction in result:
            direction["departments"].sort(key=lambda item: item["name"].lower())
        return Response(result)
