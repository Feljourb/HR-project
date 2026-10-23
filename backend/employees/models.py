from django.db import models
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

# from django.contrib import settings.AUTH_USER_MODEL

# class employees(models.Model):
#     pass