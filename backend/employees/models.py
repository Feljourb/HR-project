from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models.functions import Lower


class ReferenceItem(models.Model):
    """The mould of every dropdown list: a name, and "inactive" instead of delete
    (old employees keep their value, new forms no longer offer it)."""

    name = models.CharField("Nom", max_length=150)
    is_active = models.BooleanField("Actif", default=True)

    class Meta:
        abstract = True  # no table for the mould itself, only for the lists
        ordering = ["name"]
        constraints = [
            # "Field" and "field" are the same value: no duplicates.
            models.UniqueConstraint(
                Lower("name"),
                name="%(app_label)s_%(class)s_unique_name",
                violation_error_message="Cette valeur existe déjà.",
            ),
        ]

    def __str__(self):
        return self.name


# --- Organisation (each level points to the one above) ------------------------

class Pole(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Pôle"


class Entity(ReferenceItem):
    pole = models.ForeignKey(Pole, on_delete=models.PROTECT, related_name="entities", verbose_name="Pôle")

    class Meta(ReferenceItem.Meta):
        verbose_name = "Entité"


class Direction(ReferenceItem):
    entity = models.ForeignKey(Entity, on_delete=models.PROTECT, related_name="directions", verbose_name="Entité")

    class Meta(ReferenceItem.Meta):
        verbose_name = "Direction"
        constraints = [
            # The same direction name (e.g. "IT") may exist in two entities.
            models.UniqueConstraint(
                Lower("name"), "entity",
                name="employees_direction_unique_name_per_entity",
                violation_error_message="Cette direction existe déjà dans cette entité.",
            ),
        ]


class Department(ReferenceItem):
    direction = models.ForeignKey(Direction, on_delete=models.PROTECT, related_name="departments", verbose_name="Direction")

    class Meta(ReferenceItem.Meta):
        verbose_name = "Service / Département"
        verbose_name_plural = "Services / Départements"
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "direction",
                name="employees_department_unique_name_per_direction",
                violation_error_message="Ce service existe déjà dans cette direction.",
            ),
        ]


class Position(ReferenceItem):
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="positions", verbose_name="Service")

    class Meta(ReferenceItem.Meta):
        verbose_name = "Poste"
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "department",
                name="employees_position_unique_name_per_department",
                violation_error_message="Ce poste existe déjà dans ce service.",
            ),
        ]


# --- Simple lists ------------------------------------------------------------

class Division(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Division"


class Assignment(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Affectation"


class Category(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Catégorie"


class ContractType(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Type de contrat"
        verbose_name_plural = "Types de contrat"


class TempAgency(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Agence d'intérim"
        verbose_name_plural = "Agences d'intérim"


class Grade(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Grade"


class Region(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Région"


class CostCenter(ReferenceItem):
    code = models.CharField("Code", max_length=30)

    class Meta(ReferenceItem.Meta):
        verbose_name = "Centre de coût"
        verbose_name_plural = "Centres de coût"
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                name="employees_costcenter_unique_name",
                violation_error_message="Cette valeur existe déjà.",
            ),
            models.UniqueConstraint(
                Lower("code"),
                name="employees_costcenter_unique_code",
                violation_error_message="Ce code existe déjà.",
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"


class Bank(ReferenceItem):
    class Meta(ReferenceItem.Meta):
        verbose_name = "Banque"


# --- Employee ------------------------------------------------------------------

# Le seul type de contrat qui exige une agence d'intérim (comparé sans majuscules).
INTERIM = "Intérimaire"


class Employee(models.Model):
    """Le dossier RH d'un collaborateur (le "dossier dans l'armoire RH").

    - Le compte de connexion (username, mot de passe, rôle) est dans accounts.User :
      ici on garde seulement le lien `user` vers ce compte.
    - On stocke seulement le service (`department`) et le poste (`position`).
      La direction, l'entité et le pôle ne sont PAS stockés : on les retrouve en
      remontant depuis le service (voir les propriétés plus bas). Comme ça, la base
      ne peut jamais contenir un service et une direction qui se contredisent.
    """

    # Les "choices" : une liste fixe de valeurs. En base on garde la clé (ex. "MME"),
    # à l'écran Django affiche le libellé (ex. "Mme").
    class Title(models.TextChoices):
        MR = "M", "M."
        MRS = "MME", "Mme"

    class MaritalStatus(models.TextChoices):
        SINGLE = "SINGLE", "Célibataire"
        MARRIED = "MARRIED", "Marié(e)"
        DIVORCED = "DIVORCED", "Divorcé(e)"
        WIDOWED = "WIDOWED", "Veuf(ve)"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Actif"
        TRIAL = "TRIAL", "Période d'essai"
        LEFT = "LEFT", "Sorti"

    # Un compte <-> un dossier (OneToOne). Depuis un compte : user.employee.
    # PROTECT : impossible de supprimer un compte qui a un dossier RH.
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="employee", verbose_name="Compte")

    # Matricule U000001 : créé automatiquement dans save(), jamais modifiable
    # (editable=False le cache des formulaires). null=True seulement pendant
    # le court instant entre l'insertion et la création du matricule.
    u_number = models.CharField("Matricule", max_length=10, unique=True, null=True, editable=False)

    # Identité
    title = models.CharField("Civilité", max_length=3, choices=Title.choices)
    last_name = models.CharField("Nom", max_length=100)
    first_name = models.CharField("Prénom", max_length=100)
    birth_date = models.DateField("Date de naissance")
    # Unique : deux dossiers ne peuvent pas avoir le même CIN. Toujours stocké en
    # majuscules (voir clean() et save()), donc "ab123456" = "AB123456".
    cin = models.CharField("CIN", max_length=20, unique=True, error_messages={"unique": "Ce CIN existe déjà."})
    city = models.CharField("Ville", max_length=100)
    address = models.CharField("Adresse", max_length=255)
    country = models.CharField("Pays", max_length=100, default="Maroc")
    phone = models.CharField("Téléphone", max_length=20)
    professional_email = models.EmailField("Email professionnel")
    marital_status = models.CharField("Situation familiale", max_length=10, choices=MaritalStatus.choices)

    # Organisation : chaque champ pointe vers une liste de référence (ForeignKey).
    # PROTECT : on ne peut pas supprimer une valeur utilisée par un collaborateur
    # (on la désactive à la place). null=True, blank=True = champ optionnel.
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="employees", verbose_name="Service")
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="employees", verbose_name="Poste")
    division = models.ForeignKey(Division, on_delete=models.PROTECT, null=True, blank=True, related_name="employees", verbose_name="Division")
    assignment = models.ForeignKey(Assignment, on_delete=models.PROTECT, related_name="employees", verbose_name="Affectation")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="employees", verbose_name="Catégorie")
    contract_type = models.ForeignKey(ContractType, on_delete=models.PROTECT, related_name="employees", verbose_name="Type de contrat")
    temp_agency = models.ForeignKey(TempAgency, on_delete=models.PROTECT, null=True, blank=True, related_name="employees", verbose_name="Agence d'intérim")
    grade = models.ForeignKey(Grade, on_delete=models.PROTECT, null=True, blank=True, related_name="employees", verbose_name="Grade")
    region = models.ForeignKey(Region, on_delete=models.PROTECT, related_name="employees", verbose_name="Région")
    cost_center = models.ForeignKey(CostCenter, on_delete=models.PROTECT, null=True, blank=True, related_name="employees", verbose_name="Centre de coût")
    work_location = models.CharField("Lieu de travail", max_length=150)
    # Le N+1 est lui-même un Employee ("self"). Depuis un manager : manager.team.all().
    manager = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="team", verbose_name="Manager (N+1)")

    # Dates & situation
    hire_date = models.DateField("Date d'embauche")
    trial_end_date = models.DateField("Fin de période d'essai", null=True, blank=True)
    onboarding_end_date = models.DateField("Fin d'onboarding", null=True, blank=True)
    departure_date = models.DateField("Date de sortie", null=True, blank=True)
    status = models.CharField("Statut", max_length=6, choices=Status.choices, default=Status.ACTIVE)
    # En jours, avec des demi-journées possibles (ex. 12.5). Jamais négatif.
    initial_leave_balance = models.DecimalField(
        "Solde de congés initial (jours)", max_digits=5, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal("0"))],
    )

    class Meta:
        verbose_name = "Collaborateur"
        ordering = ["last_name", "first_name"]

    def __str__(self):
        # Texte affiché partout (listes, admin) : "U000007 - ALAMI Ahmed".
        return f"{self.u_number} - {self.last_name.upper()} {self.first_name}"

    # --- Valeurs calculées (jamais stockées) ---------------------------------
    # @property : on écrit ahmed.pole comme un champ, mais la valeur est
    # recalculée à chaque fois en remontant : service -> direction -> entité -> pôle.

    @property
    def direction(self):
        return self.department.direction

    @property
    def entity(self):
        return self.department.direction.entity

    @property
    def pole(self):
        # Sert à savoir quel RH peut voir ce dossier (RH SBD ou RH Riaya).
        return self.department.direction.entity.pole

    @property
    def n_plus_2(self):
        # Le manager de mon manager (None si je n'ai pas de manager).
        return self.manager.manager if self.manager else None

    @property
    def n_plus_3(self):
        return self.n_plus_2.manager if self.n_plus_2 else None

    # --- Règles de validation -------------------------------------------------

    def clean(self):
        """Vérifie le dossier AVANT l'enregistrement (admin, API, import...).
        Si une règle n'est pas respectée, on lève une erreur par champ
        et rien n'est enregistré."""
        self.cin = self.cin.strip().upper()  # "ab123456" et "AB123456" = le même CIN
        errors = {}

        # Règle 1 : le poste doit appartenir au service choisi
        # (ex. refusé : service "Ventes" + poste "Magasinier" qui est dans "Entreposage").
        if self.position_id and self.department_id and self.position.department_id != self.department_id:
            errors["position"] = "Ce poste n'appartient pas au service choisi."

        # Règle 2 : l'agence d'intérim est obligatoire pour un intérimaire,
        # et interdite pour les autres contrats (CDI, CDD...).
        if self.contract_type_id:
            is_interim = self.contract_type.name.lower() == INTERIM.lower()
            if is_interim and not self.temp_agency_id:
                errors["temp_agency"] = "Obligatoire pour un intérimaire."
            elif not is_interim and self.temp_agency_id:
                errors["temp_agency"] = "Seulement pour un contrat Intérimaire."

        # Règle 3 : pas de boucle dans la hiérarchie (ex. A manager de B et B manager de A).
        # On remonte les managers un par un : si on retombe sur ce collaborateur, c'est une boucle.
        # `seen` évite de tourner à l'infini si une ancienne donnée contient déjà une boucle.
        manager, seen = self.manager, set()
        while manager is not None and manager.pk not in seen:
            if manager.pk == self.pk:
                errors["manager"] = "Un collaborateur ne peut pas être son propre manager (direct ou indirect)."
                break
            seen.add(manager.pk)
            manager = manager.manager

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Enregistre le dossier, et crée le matricule la première fois."""
        self.cin = self.cin.strip().upper()  # aussi ici : objects.create() n'appelle pas clean()
        # atomic : les deux écritures passent ensemble, ou aucune (jamais de dossier sans matricule).
        with transaction.atomic():
            super().save(*args, **kwargs)  # 1. PostgreSQL enregistre et donne un id (ex. 7)
            if self.u_number is None:  # 2. seulement pour un nouveau dossier
                # 3. Le matricule vient de l'id : 7 -> "U000007" (6 chiffres).
                #    L'id ne revient jamais en arrière (même après une suppression),
                #    donc un matricule n'est jamais donné deux fois.
                self.u_number = f"U{self.pk:06d}"
                super().save(update_fields=["u_number"])
