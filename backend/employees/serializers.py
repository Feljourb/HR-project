"""Serializers : la traduction entre un objet Python (modèle) et du JSON pour l'API.

Ex. un Position devient {"id": 12, "name": "Commercial terrain", "is_active": true, "department": 4}.
"""
from copy import copy

from django.contrib.auth import get_user_model
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.services import can_reset_password

from . import services
from .models import Employee

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

# Ce qu'un collaborateur peut modifier lui-même dans son dossier (le reste : seulement les RH).
PERSONAL_FIELDS = ["phone", "address", "city", "country"]


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
    # Écriture seule, et seulement à la création : le rôle du compte créé (Collaborateur par défaut).
    role = serializers.ChoiceField(choices=User.Role.choices, write_only=True, required=False)

    class Meta:
        model = Employee
        exclude = ["user"]  # le compte est créé automatiquement, jamais choisi
        # u_number n'est pas modifiable (editable=False) : DRF le met en lecture seule tout seul.

    def get_can_reset_password(self, employee):
        request = self.context.get("request")
        return bool(request and can_reset_password(request.user, employee.user))

    def validate_role(self, role):
        # Sans cette règle, un RH pourrait créer un compte Admin RH... et se donner tous les droits.
        if role in (User.Role.HR, User.Role.HR_ADMIN) and not services.sees_both_poles(self.context["request"].user):
            raise serializers.ValidationError("Seul l'Admin RH peut donner un rôle RH.")
        return role

    def validate(self, attrs):
        # 1. Les règles du modèle (poste du bon service, CIN unique, agence d'intérim...).
        #    "role" n'est pas un champ du modèle : on le saute. "user" n'existe pas encore à la création.
        instance = preview(self, attrs, skip=["role"])
        check_model_rules(instance, exclude=["user"])

        # 2. Un RH ne crée / ne déplace un collaborateur que dans SON pôle.
        user = self.context["request"].user
        if services.limited_to_own_pole(user):
            pole = services.user_pole(user)
            if pole is None or instance.pole.pk != pole.pk:
                raise serializers.ValidationError({"department": "Ce service n'appartient pas à votre pôle."})
        return attrs

    def create(self, validated_data):
        # Création : le service crée le compte (prénom.nom + CIN) en même temps que le dossier.
        role = validated_data.pop("role", None)
        return services.create_with_account(Employee(**validated_data), role=role)

    def update(self, instance, validated_data):
        validated_data.pop("role", None)  # le rôle se change dans les comptes (IT), pas ici
        return super().update(instance, validated_data)


class MyFicheSerializer(EmployeeSerializer):
    """Le dossier vu par son propriétaire (/me/) : tout est lisible,
    mais seuls les champs personnels (PERSONAL_FIELDS) sont modifiables."""

    role = None  # "role = None" retire ce champ hérité : rien à faire ici

    class Meta(EmployeeSerializer.Meta):
        read_only_fields = [
            field.name for field in Employee._meta.fields
            if field.name not in PERSONAL_FIELDS + ["user", "id", "u_number"]
        ]
