from django.contrib import admin

from . import services
from .models import (
    Assignment, Bank, Category, ContractType, CostCenter, Department, Direction, Division,
    Employee, Entity, Grade, Pole, Position, Region, TempAgency,
)


class ReferenceAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)

    # Never delete a value used by employees: untick "Actif" instead.
    def has_delete_permission(self, request, obj=None):
        return False


for model in (Pole, Division, Assignment,Category, ContractType, TempAgency, Grade, Region, Bank):
    admin.site.register(model, ReferenceAdmin)


@admin.register(Entity)
class EntityAdmin(ReferenceAdmin):
    list_display = ("name", "pole", "is_active")
    list_filter = ("pole", "is_active")


@admin.register(Direction)
class DirectionAdmin(ReferenceAdmin):
    list_display = ("name", "entity", "is_active")
    list_filter = ("entity__pole", "entity", "is_active")


@admin.register(Department)
class DepartmentAdmin(ReferenceAdmin):
    list_display = ("name", "direction", "is_active")
    list_filter = ("direction__entity", "direction", "is_active")


@admin.register(Position)
class PositionAdmin(ReferenceAdmin):
    list_display = ("name", "department", "direction", "is_active")
    list_filter = ("department__direction__entity", "department__direction", "department", "is_active")
    list_select_related = ("department__direction",)

    @admin.display(description="Direction", ordering="department__direction__name")
    def direction(self, obj):
        return obj.department.direction


@admin.register(CostCenter)
class CostCenterAdmin(ReferenceAdmin):
    list_display = ("code", "name", "is_active")
    search_fields = ("code", "name")


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    """Écran des collaborateurs dans /admin (outil de l'IT, pas l'interface des RH)."""

    # Colonnes de la liste.
    list_display = ("u_number", "last_name", "first_name", "position", "department", "status")
    # Charge poste et service dans la même requête SQL (sinon 1 requête par ligne).
    list_select_related = ("position", "department")
    # Barre de recherche et filtres à droite.
    search_fields = ("last_name", "first_name", "cin", "u_number")
    list_filter = ("status", "department__direction__entity", "contract_type")
    # Le manager se cherche en tapant son nom, au lieu d'une liste déroulante énorme.
    autocomplete_fields = ("manager",)
    # Affichés mais pas modifiables : le matricule et les valeurs calculées (propriétés du modèle).
    readonly_fields = ("u_number", "direction", "entity", "pole", "n_plus_2", "n_plus_3")
    # Le formulaire, découpé en blocs.
    fieldsets = (
        (None, {"fields": ("user", "u_number", "status")}),
        ("Identité", {"fields": (
            "title", "last_name", "first_name", "birth_date", "cin", "marital_status",
            "phone", "professional_email", "address", "city", "country",
        )}),
        ("Organisation", {"fields": ("department", "position", "direction", "entity", "pole")}),
        ("Contrat", {"fields": (
            "contract_type", "temp_agency", "category", "grade", "division",
            "assignment", "region", "work_location", "cost_center",
        )}),
        ("Hiérarchie", {"fields": ("manager", "n_plus_2", "n_plus_3")}),
        ("Dates", {"fields": (
            "hire_date", "trial_end_date", "onboarding_end_date", "departure_date", "initial_leave_balance",
        )}),
    )

    def get_fieldsets(self, request, obj=None):
        """Ajout (obj est None) : pas de champ "Compte", il est créé à partir du dossier.
        Modification : on garde tous les blocs (le compte est affiché en lecture seule)."""
        if obj:
            return self.fieldsets
        first, *others = self.fieldsets  # on remplace seulement le 1er bloc
        return ((None, {"fields": ("status",)}), *others)

    def get_readonly_fields(self, request, obj=None):
        # En modification, le compte est visible mais ne peut pas être changé.
        return (*self.readonly_fields, "user") if obj else self.readonly_fields

    def save_model(self, request, obj, form, change):
        """Appelé par l'admin au clic sur "Enregistrer"."""
        if change:  # modification d'un dossier existant : enregistrement normal
            return super().save_model(request, obj, form, change)
        # Nouveau dossier : on passe par le service (compte + dossier + matricule ensemble).
        services.create_with_account(obj)
        # Message en haut de la page pour que l'IT/RH sache quoi transmettre au collaborateur.
        self.message_user(
            request,
            f"Compte créé : {obj.user.username} (mot de passe temporaire : CIN {obj.cin}). "
            f"Matricule : {obj.u_number}.",
        )

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        """Des services comme "Ventes" ou "Direction" existent dans plusieurs entités :
        dans les listes déroulantes, on affiche le chemin complet (Entité › Direction › Service › Poste)."""
        field = super().formfield_for_foreignkey(db_field, request, **kwargs)
        if db_field.name == "department":
            field.queryset = field.queryset.select_related("direction__entity").order_by(
                "direction__entity__name", "direction__name", "name")
            field.label_from_instance = lambda d: f"{d.direction.entity} › {d.direction} › {d}"
        elif db_field.name == "position":
            field.queryset = field.queryset.select_related("department__direction__entity").order_by(
                "department__direction__entity__name", "department__direction__name", "department__name", "name")
            field.label_from_instance = lambda p: (
                f"{p.department.direction.entity} › {p.department.direction} › {p.department} › {p}")
        return field

