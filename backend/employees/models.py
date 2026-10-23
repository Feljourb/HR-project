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

INTERIM = "Intérimaire"  # the contract type that needs a temp agency


class Employee(models.Model):
    """The HR file of a collaborator. Direction, entité and pôle are not stored:
    they come from the department (see the properties)."""

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

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="employee", verbose_name="Compte")
    u_number = models.CharField("Matricule", max_length=10, unique=True, null=True, editable=False)

    # Identité
    title = models.CharField("Civilité", max_length=3, choices=Title.choices)
    last_name = models.CharField("Nom", max_length=100)
    first_name = models.CharField("Prénom", max_length=100)
    birth_date = models.DateField("Date de naissance")
    cin = models.CharField("CIN", max_length=20, unique=True, error_messages={"unique": "Ce CIN existe déjà."})
    city = models.CharField("Ville", max_length=100)
    address = models.CharField("Adresse", max_length=255)
    country = models.CharField("Pays", max_length=100, default="Maroc")
    phone = models.CharField("Téléphone", max_length=20)
    professional_email = models.EmailField("Email professionnel")
    marital_status = models.CharField("Situation familiale", max_length=10, choices=MaritalStatus.choices)

    # Organisation
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
    manager = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="team", verbose_name="Manager (N+1)")

    # Dates & situation
    hire_date = models.DateField("Date d'embauche")
    trial_end_date = models.DateField("Fin de période d'essai", null=True, blank=True)
    onboarding_end_date = models.DateField("Fin d'onboarding", null=True, blank=True)
    departure_date = models.DateField("Date de sortie", null=True, blank=True)
    status = models.CharField("Statut", max_length=6, choices=Status.choices, default=Status.ACTIVE)
    initial_leave_balance = models.DecimalField(
        "Solde de congés initial (jours)", max_digits=5, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal("0"))],
    )

    class Meta:
        verbose_name = "Collaborateur"
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.u_number} - {self.last_name.upper()} {self.first_name}"

    # Computed from the department, never stored.
    @property
    def direction(self):
        return self.department.direction

    @property
    def entity(self):
        return self.department.direction.entity

    @property
    def pole(self):
        return self.department.direction.entity.pole

    @property
    def n_plus_2(self):
        return self.manager.manager if self.manager else None

    @property
    def n_plus_3(self):
        return self.n_plus_2.manager if self.n_plus_2 else None

    def clean(self):
        self.cin = self.cin.strip().upper()  # "ab123456" and "AB123456" are the same CIN
        errors = {}

        if self.position_id and self.department_id and self.position.department_id != self.department_id:
            errors["position"] = "Ce poste n'appartient pas au service choisi."

        if self.contract_type_id:
            is_interim = self.contract_type.name.lower() == INTERIM.lower()
            if is_interim and not self.temp_agency_id:
                errors["temp_agency"] = "Obligatoire pour un intérimaire."
            elif not is_interim and self.temp_agency_id:
                errors["temp_agency"] = "Seulement pour un contrat Intérimaire."

        # Walk up the managers: the employee must not be found (A -> B -> A).
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
        self.cin = self.cin.strip().upper()
        with transaction.atomic():
            super().save(*args, **kwargs)
            if self.u_number is None:
                # Built from the id: unique, in order, and never changes.
                self.u_number = f"U{self.pk:06d}"
                super().save(update_fields=["u_number"])