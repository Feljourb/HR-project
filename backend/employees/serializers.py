"""Serializers : la traduction entre un objet Python (modèle) et du JSON pour l'API.

Ex. un Position devient {"id": 12, "name": "Commercial terrain", "is_active": true, "department": 4}.
"""
from copy import copy

from django.contrib.auth import get_user_model
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from accounts.services import can_change_role, can_give_role_to_new_account, can_reset_password

from . import history, notifications, services
from .models import Child, Employee, EmployeeHistory, Notification

User = get_user_model()


def check_model_rules(instance, exclude=None):
    """Lance les règles du modèle (full_clean) et les transforme en erreur 400 de l'API.

    Pourquoi : DRF ne connaît pas nos règles (nom unique sans majuscules, poste du bon
    service...). Sans ce contrôle, une donnée fausse arriverait jusqu'à PostgreSQL et
    l'API répondrait une erreur 500 au lieu d'un message clair."""
    try:
        instance.full_clean(exclude=exclude)  # les mêmes règles que dans l'admin
    except DjangoValidationError as error:
        errors = error.message_dict
        # Une erreur de contrainte (ex. "Cette valeur existe déjà.") n'est liée à aucun
        # champ : Django la range sous "__all__", DRF l'appelle "non_field_errors".
        if NON_FIELD_ERRORS in errors:
            errors["non_field_errors"] = errors.pop(NON_FIELD_ERRORS)
        raise serializers.ValidationError(errors)


def preview(serializer, attrs, skip=()):
    """L'objet tel qu'il serait après l'enregistrement, SANS l'enregistrer.
    copy() : si la validation échoue, l'objet original n'est pas touché."""
    instance = copy(serializer.instance) if serializer.instance else serializer.Meta.model()
    for field, value in attrs.items():
        if field not in skip:
            setattr(instance, field, value)
    return instance


# --- Listes de référence (step 4) ---------------------------------------------

class ReferenceSerializer(serializers.ModelSerializer):
    """Base commune à toutes les listes (pôles, postes, banques...).
    Chaque liste a son propre serializer créé dans views.py (avec son modèle)."""

    def validate(self, attrs):
        check_model_rules(preview(self, attrs))
        return attrs


# --- Collaborateurs (step 5) -----------------------------------------------------

# Ce qu'un collaborateur peut modifier lui-même dans son dossier (le reste : seulement les RH,
# car il faut un justificatif : CIN, RIB, CNSS, enfants...).
PERSONAL_FIELDS = [
    "phone", "address", "city", "country",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
]


class ChildSerializer(serializers.ModelSerializer):
    """Un enfant dans le dossier : {"id": 3, "first_name": "Yasmine", "birth_date": "2018-04-02"}.
    La règle "pas de date dans le futur" vient du modèle (validators=[not_in_future])."""

    class Meta:
        model = Child
        fields = ["id", "first_name", "birth_date"]


class EmployeeListSerializer(serializers.ModelSerializer):
    """Une ligne du tableau des collaborateurs : peu de champs, et des NOMS lisibles
    (pas des numéros), pour afficher directement "Ventes" au lieu de 4."""

    # StringRelatedField : le texte de l'objet lié (son __str__), ex. "Commercial terrain".
    position = serializers.StringRelatedField()
    department = serializers.StringRelatedField()
    contract_type = serializers.StringRelatedField()
    # source="direction.name" : on lit la propriété employee.direction, puis son nom.
    direction = serializers.CharField(source="direction.name", read_only=True)
    entity = serializers.CharField(source="entity.name", read_only=True)
    # get_status_display() : le libellé du statut ("Période d'essai" au lieu de "TRIAL").
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id", "u_number", "last_name", "first_name", "position", "department",
            "direction", "entity", "contract_type", "status", "status_label",
        ]


class EmployeeSerializer(serializers.ModelSerializer):
    """Le dossier complet : pour voir, créer et modifier un collaborateur.
    Les listes liées sont des numéros (id), comme les valeurs des listes déroulantes."""

    # Lecture seule : le compte et les valeurs calculées à partir du service.
    username = serializers.CharField(source="user.username", read_only=True)
    direction = serializers.PrimaryKeyRelatedField(read_only=True)
    entity = serializers.PrimaryKeyRelatedField(read_only=True)
    pole = serializers.PrimaryKeyRelatedField(read_only=True)
    n_plus_2 = serializers.PrimaryKeyRelatedField(read_only=True)
    n_plus_3 = serializers.PrimaryKeyRelatedField(read_only=True)
    # Le texte du manager ("U000002 - TEST Manager") pour l'afficher dans le formulaire,
    # même si le RH ne peut pas ouvrir son dossier (manager d'un autre pôle).
    manager_label = serializers.StringRelatedField(source="manager", read_only=True)
    # Le frontend affiche le bouton "Réinitialiser le mot de passe" seulement si c'est vrai.
    # Même règle que l'API (accounts.services.can_reset_password) : jamais deux règles différentes.
    can_reset_password = serializers.SerializerMethodField()
    # Écriture : le rôle du compte (création : Collaborateur par défaut ; modification : voir validate).
    role = serializers.ChoiceField(choices=User.Role.choices, write_only=True, required=False)
    # Lecture : le rôle actuel du compte, et les rôles que CE RH peut lui donner (liste vide : il ne
    # peut pas le changer). Le frontend construit la liste déroulante avec : une seule règle, celle de Django.
    account_role = serializers.CharField(source="user.role", read_only=True)
    assignable_roles = serializers.SerializerMethodField()
    # Les enfants : une liste dans le dossier. À l'enregistrement, la liste envoyée REMPLACE
    # l'ancienne (voir save_children). Le nombre d'enfants est calculé, jamais saisi.
    children = ChildSerializer(many=True, required=False)
    number_of_children = serializers.IntegerField(read_only=True)

    class Meta:
        model = Employee
        exclude = ["user"]  # le compte est créé automatiquement, jamais choisi
        # u_number n'est pas modifiable (editable=False) : DRF le met en lecture seule tout seul.

    def get_can_reset_password(self, employee):
        request = self.context.get("request")
        return bool(request and can_reset_password(request.user, employee.user))

    def get_assignable_roles(self, employee):
        request = self.context.get("request")
        if request is None:
            return []
        return [role for role in User.Role.values if can_change_role(request.user, employee.user, role)]

    def validate_role(self, role):
        # Création : sans cette règle, un RH pourrait créer un compte Admin RH... et se donner tous
        # les droits. (Modification d'un compte existant : voir validate, étape 3.)
        if self.instance is None and not can_give_role_to_new_account(self.context["request"].user, role):
            raise serializers.ValidationError("Vous ne pouvez pas donner ce rôle.")
        return role

    def validate(self, attrs):
        # 1. Les règles du modèle (poste du bon service, CIN unique, agence d'intérim, RIB...).
        #    "role" et "children" ne sont pas des champs du modèle : on les saute.
        #    "user" n'existe pas encore à la création.
        instance = preview(self, attrs, skip=["role", "children"])
        check_model_rules(instance, exclude=["user"])

        # 2. Un RH ne crée / ne déplace un collaborateur que dans SON pôle.
        user = self.context["request"].user
        if services.limited_to_own_pole(user):
            pole = services.user_pole(user)
            if pole is None or instance.pole.pk != pole.pk:
                raise serializers.ValidationError({"department": "Ce service n'appartient pas à votre pôle."})

        # 3. Changer le rôle d'un compte EXISTANT : jamais le sien, RH <-> Admin RH seulement
        #    par l'Admin RH... (voir accounts.services.can_change_role).
        role = attrs.get("role")
        if self.instance is not None and role and role != self.instance.user.role:
            if not can_change_role(user, self.instance.user, role):
                raise serializers.ValidationError({"role": "Vous ne pouvez pas donner ce rôle à ce compte."})
        return attrs

    # atomic : le dossier et ses enfants sont enregistrés ensemble, ou pas du tout.
    @transaction.atomic
    def create(self, validated_data):
        # Création : le service crée le compte (prénom.nom + CIN) en même temps que le dossier.
        role = validated_data.pop("role", None)
        children = validated_data.pop("children", [])
        employee = services.create_with_account(Employee(**validated_data), role=role)
        self.save_children(employee, children)
        history.record(employee, self.context["request"].user, EmployeeHistory.Action.CREATED,
                       [{"field": "Rôle du compte", "old": "", "new": employee.user.get_role_display()}])
        return employee

    @transaction.atomic
    def update(self, instance, validated_data):
        actor = self.context["request"].user
        before = history.snapshot(instance)  # la "photo" AVANT les changements, pour l'historique
        role = validated_data.pop("role", None)
        children = validated_data.pop("children", None)  # None = liste pas envoyée : on n'y touche pas
        employee = super().update(instance, validated_data)
        if children is not None:
            self.save_children(employee, children)
        history.record_changes(employee, actor, before)  # une ligne seulement si quelque chose a changé

        # Le rôle est dans le compte, pas dans le dossier (validate a déjà vérifié le droit de le changer).
        if role and role != employee.user.role:
            old_label = employee.user.get_role_display()
            employee.user.role = role
            employee.user.save(update_fields=["role"])
            history.record_role(employee, actor, old_label, employee.user.get_role_display())
        return employee

    @staticmethod
    def save_children(employee, children):
        """Remplace la liste des enfants par celle du formulaire (le plus simple et le plus sûr :
        ce qui est à l'écran est exactement ce qui est en base)."""
        employee.children.all().delete()
        Child.objects.bulk_create(Child(employee=employee, **child) for child in children)


class HistorySerializer(serializers.ModelSerializer):
    """Une ligne de l'historique d'un dossier (lecture seule)."""

    action_label = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = EmployeeHistory
        fields = ["id", "created_at", "actor_name", "action", "action_label", "changes"]


class AuditLogSerializer(HistorySerializer):
    """Une ligne du journal de tous les dossiers : la même chose + le dossier concerné."""

    employee_label = serializers.StringRelatedField(source="employee")  # "U000007 - ALAMI Ahmed"

    class Meta(HistorySerializer.Meta):
        fields = [*HistorySerializer.Meta.fields, "employee", "employee_label"]


class NotificationSerializer(serializers.ModelSerializer):
    """Une notification de la cloche. Le texte est calculé aujourd'hui (voir notifications.message)."""

    title = serializers.CharField(source="get_kind_display", read_only=True)
    message = serializers.SerializerMethodField()
    read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "message", "employee", "due_date", "read", "created_at"]

    def get_message(self, notification):
        return notifications.message(notification)

    def get_read(self, notification):
        return notification.read_at is not None


class DirectorySerializer(serializers.ModelSerializer):
    """Une personne dans l'annuaire : SEULEMENT les champs publics.

    Tout le monde voit l'annuaire (les deux pôles) : on n'envoie jamais le CIN,
    l'adresse, le contrat ou la date de naissance. La liste `fields` est écrite à la
    main, exprès : un nouveau champ ajouté au modèle ne devient pas public par erreur."""

    position = serializers.StringRelatedField()
    department = serializers.StringRelatedField()
    direction = serializers.CharField(source="direction.name", read_only=True)

    class Meta:
        model = Employee
        fields = ["id", "last_name", "first_name", "position", "department", "direction", "professional_email", "phone"]


class MyFicheSerializer(EmployeeSerializer):
    """Le dossier vu par son propriétaire (/me/) : tout est lisible,
    mais seuls les champs personnels (PERSONAL_FIELDS) sont modifiables.

    Les listes liées arrivent en TEXTE ("Commercial terrain"), pas en numéro (12) :
    la page "Mon profil" les affiche telles quelles, sans listes déroulantes pour les traduire."""

    # Tous les liens créés automatiquement (poste, service, banque, manager...) : leur texte (__str__).
    serializer_related_field = serializers.StringRelatedField
    # Les valeurs calculées depuis le service, déclarées à la main dans EmployeeSerializer : en texte aussi.
    direction = serializers.StringRelatedField()
    entity = serializers.StringRelatedField()
    pole = serializers.StringRelatedField()
    n_plus_2 = serializers.StringRelatedField()
    n_plus_3 = serializers.StringRelatedField()

    role = None  # "role = None" retire ce champ hérité : on ne change pas son propre rôle
    assignable_roles = None
    children = ChildSerializer(many=True, read_only=True)  # visibles, modifiables seulement par les RH

    class Meta(EmployeeSerializer.Meta):
        read_only_fields = [
            field.name for field in Employee._meta.fields
            if field.name not in PERSONAL_FIELDS + ["user", "id", "u_number"]
        ]
