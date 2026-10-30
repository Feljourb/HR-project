from django import forms
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils.html import format_html

from . import history, services
from .models import (
    Assignment, Bank, Category, Child, ContractType, CostCenter, Department, Direction, Division,
    Employee, EmployeeHistory, Entity, Grade, Pole, Position, Region, TempAgency,
)


class ReferenceAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)

    # Never delete a value used by employees: untick "Actif" instead.
    def has_delete_permission(self, request, obj=None):
        return False


for model in (Division, Assignment,Category, ContractType, TempAgency, Grade, Region, Bank):
    admin.site.register(model, ReferenceAdmin)


@admin.register(Pole)
class PoleAdmin(ReferenceAdmin):
    list_display = ("name", "director", "is_active")
    # Le DG est un collaborateur : une case de recherche (nom, matricule...) au lieu d'une longue liste.
    autocomplete_fields = ("director",)


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


class ChildInline(admin.TabularInline):
    """Les enfants, en petit tableau DANS la fiche du collaborateur (une ligne par enfant)."""
    model = Child
    extra = 0  # pas de lignes vides en plus : bouton "Ajouter un autre Enfant"


User = get_user_model()


class EmployeeAdminForm(forms.ModelForm):
    """Le formulaire de la fiche + un champ qui n'est pas dans le modèle Employee :
    le rôle du compte créé avec la fiche (le rôle est stocké dans le compte, accounts.User)."""

    role = forms.ChoiceField(label="Rôle du compte", choices=User.Role.choices, initial=User.Role.COLLABORATOR)

    class Meta:
        model = Employee
        fields = "__all__"


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    """Écran des collaborateurs dans /admin (outil de l'IT, pas l'interface des RH)."""

    form = EmployeeAdminForm
    inlines = [ChildInline]

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
    readonly_fields = ("u_number", "account_role", "direction", "entity", "pole", "n_plus_2", "n_plus_3")
    # Le formulaire, découpé en blocs.
    fieldsets = (
        (None, {"fields": ("user", "account_role", "u_number", "status")}),
        ("Identité", {"fields": (
            "title", "last_name", "first_name", "birth_date", "cin",
            "phone", "professional_email", "address", "city", "country",
        )}),
        ("Situation familiale", {"fields": ("marital_status",)}),  # + les enfants, en bas de la page
        ("Dossier administratif", {"fields": ("cnss_number", "cimr_number", "bank", "rib")}),
        ("Contact d'urgence", {"fields": (
            "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
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
        """Ajout (obj est None) : pas de champ "Compte", il est créé à partir du dossier ;
        à la place, on choisit son rôle.
        Modification : on garde tous les blocs (le compte et son rôle en lecture seule)."""
        if obj:
            return self.fieldsets
        first, *others = self.fieldsets  # on remplace seulement le 1er bloc
        return ((None, {"fields": ("role", "status")}), *others)

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        # Modification : pas de champ "Rôle du compte" (il est affiché avec un lien vers le compte).
        # Sans ça, le champ obligatoire mais caché bloquerait l'enregistrement.
        if obj:
            form.base_fields.pop("role", None)
        return form

    def get_readonly_fields(self, request, obj=None):
        # En modification, le compte est visible mais ne peut pas être changé.
        return (*self.readonly_fields, "user") if obj else self.readonly_fields

    @admin.display(description="Rôle du compte")
    def account_role(self, obj):
        """Le rôle actuel, et un lien vers le compte pour le changer (Comptes > Utilisateurs)."""
        if obj is None or obj.user_id is None:
            return "-"
        url = reverse("admin:accounts_user_change", args=[obj.user_id])
        return format_html('{} (<a href="{}">changer dans le compte</a>)', obj.user.get_role_display(), url)

    def save_model(self, request, obj, form, change):
        """Appelé par l'admin au clic sur "Enregistrer"."""
        if change:  # modification d'un dossier existant : enregistrement normal
            # La photo AVANT (lue en base : `obj` contient déjà les nouvelles valeurs du formulaire).
            # Comparée dans save_related, quand les enfants (inline) sont enregistrés aussi.
            obj._history_before = history.snapshot(Employee.objects.get(pk=obj.pk))
            return super().save_model(request, obj, form, change)
        # Nouveau dossier : on passe par le service (compte + dossier + matricule ensemble),
        # avec le rôle choisi dans le formulaire.
        services.create_with_account(obj, role=form.cleaned_data["role"])
        history.record(obj, request.user, EmployeeHistory.Action.CREATED,
                       [{"field": "Rôle du compte", "old": "", "new": obj.user.get_role_display()}])
        # Message en haut de la page pour que l'IT/RH sache quoi transmettre au collaborateur.
        self.message_user(
            request,
            f"Compte créé : {obj.user.username} ({obj.user.get_role_display()}, mot de passe temporaire : "
            f"CIN {obj.cin}). Matricule : {obj.u_number}.",
        )

    def save_related(self, request, form, formsets, change):
        """Après le dossier, l'admin enregistre les enfants (inline) : on écrit l'historique ici."""
        super().save_related(request, form, formsets, change)
        before = getattr(form.instance, "_history_before", None)
        if change and before is not None:
            history.record_changes(form.instance, request.user, before)

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


@admin.register(EmployeeHistory)
class EmployeeHistoryAdmin(admin.ModelAdmin):
    """L'historique dans /admin : en LECTURE SEULE. Un historique qu'on peut modifier
    ou supprimer ne prouve plus rien."""

    list_display = ("created_at", "employee", "action", "actor_name")
    list_filter = ("action",)
    search_fields = ("employee__last_name", "employee__first_name", "employee__u_number", "actor_name")
    list_select_related = ("employee",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

