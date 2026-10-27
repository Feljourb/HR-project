from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models.functions import Lower

from accounts.services import set_account_active


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


def digits_only(value):
    """ "0011 7800 ..." -> "00117800..." : on accepte les espaces à la saisie, on stocke sans."""
    return (value or "").replace(" ", "")


def not_in_future(day):
    """Refuse une date après aujourd'hui (ex. date de naissance d'un enfant)."""
    if day > date.today():
        raise ValidationError("Cette date est dans le futur.")


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

    # Le lien entre le collaborateur et son contact d'urgence (liste fixe, décidée avec les RH).
    class Relationship(models.TextChoices):
        SPOUSE = "SPOUSE", "Conjoint(e)"
        FATHER = "FATHER", "Père"
        MOTHER = "MOTHER", "Mère"
        SIBLING = "SIBLING", "Frère / Sœur"
        CHILD = "CHILD", "Enfant"
        OTHER = "OTHER", "Autre"

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

    # Situation familiale (optionnelle, comme sur la fiche validée par les RH).
    # Les enfants sont dans le modèle Child (plus bas) ; leur nombre est calculé.
    marital_status = models.CharField("Situation familiale", max_length=10, choices=MaritalStatus.choices, blank=True)

    # Dossier administratif (optionnel : rempli quand le collaborateur apporte ses papiers).
    # Les numéros sont stockés sans espaces ; CNSS et CIMR sont uniques quand ils sont remplis
    # (voir les contraintes dans Meta).
    cnss_number = models.CharField("N° CNSS", max_length=20, blank=True)
    cimr_number = models.CharField("N° CIMR", max_length=20, blank=True)
    bank = models.ForeignKey(Bank, on_delete=models.PROTECT, null=True, blank=True, related_name="employees", verbose_name="Banque")
    # 30 caractères à la saisie (24 chiffres + espaces, comme sur un relevé) ; stocké sans espaces (24).
    rib = models.CharField("RIB", max_length=30, blank=True, help_text="24 chiffres.")

    # Contact d'urgence (un seul). Le collaborateur peut le modifier lui-même (Mon profil).
    emergency_contact_name = models.CharField("Contact d'urgence : nom et prénom", max_length=150, blank=True)
    emergency_contact_relationship = models.CharField("Lien avec l'employé", max_length=10, choices=Relationship.choices, blank=True)
    emergency_contact_phone = models.CharField("Contact d'urgence : téléphone", max_length=20, blank=True)

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
        constraints = [
            # Uniques SEULEMENT quand ils sont remplis : plusieurs dossiers sans CNSS (vide) sont permis.
            # violation_error_code="unique" : Django affiche l'erreur sous le champ (pas en haut du formulaire).
            models.UniqueConstraint(
                fields=["cnss_number"], condition=~models.Q(cnss_number=""), name="employees_employee_unique_cnss",
                violation_error_message="Ce numéro CNSS existe déjà.", violation_error_code="unique",
            ),
            models.UniqueConstraint(
                fields=["cimr_number"], condition=~models.Q(cimr_number=""), name="employees_employee_unique_cimr",
                violation_error_message="Ce numéro CIMR existe déjà.", violation_error_code="unique",
            ),
        ]

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

    @property
    def number_of_children(self):
        # Calculé depuis la liste des enfants : jamais un nombre qui contredit la liste.
        return self.children.count() if self.pk else 0

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

        # Règle 4 : le RIB marocain fait 24 chiffres (banque 3 + ville 3 + compte 16 + clé 2),
        # et il va avec sa banque. Les espaces sont acceptés à la saisie et enlevés.
        self.rib = digits_only(self.rib)
        if self.rib:
            if not (self.rib.isdigit() and len(self.rib) == 24):
                errors["rib"] = "Le RIB doit contenir 24 chiffres."
            elif not self.bank_id:
                errors["bank"] = "Choisissez la banque de ce RIB."

        # Règle 5 : le numéro CNSS ne contient que des chiffres.
        self.cnss_number = digits_only(self.cnss_number)
        if self.cnss_number and not self.cnss_number.isdigit():
            errors["cnss_number"] = "Le numéro CNSS ne contient que des chiffres."

        # Règle 6 : un contact d'urgence sans téléphone ne sert à rien (et un numéro sans nom non plus).
        has_name, has_phone = bool(self.emergency_contact_name.strip()), bool(self.emergency_contact_phone.strip())
        if has_name and not has_phone:
            errors["emergency_contact_phone"] = "Indiquez le téléphone du contact d'urgence."
        elif has_phone and not has_name:
            errors["emergency_contact_name"] = "Indiquez le nom du contact d'urgence."

        # Règle 7 : un collaborateur "Sorti" a une date de sortie (son compte sera bloqué, voir save()).
        if self.status == self.Status.LEFT and not self.departure_date:
            errors["departure_date"] = "Obligatoire pour un collaborateur sorti."

        # Règle 8 : on ne sort pas avant d'être entré.
        if self.departure_date and self.hire_date and self.departure_date < self.hire_date:
            errors["departure_date"] = "La date de sortie est avant la date d'embauche."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Enregistre le dossier, et crée le matricule la première fois."""
        self.cin = self.cin.strip().upper()  # aussi ici : objects.create() n'appelle pas clean()
        # Noms propres : espaces en trop enlevés, NOM en majuscules, Prénom avec une majuscule.
        self.last_name = " ".join(self.last_name.split()).upper()
        self.first_name = " ".join(self.first_name.split()).title()
        # Numéros sans espaces (voir clean()).
        self.rib = digits_only(self.rib)
        self.cnss_number = digits_only(self.cnss_number)

        # atomic : toutes les écritures passent ensemble, ou aucune (jamais de dossier sans matricule,
        # jamais un "Sorti" avec un compte encore ouvert).
        with transaction.atomic():
            # Le statut AVANT cette modification (None pour un nouveau dossier).
            old_status = Employee.objects.filter(pk=self.pk).values_list("status", flat=True).first() if self.pk else None

            super().save(*args, **kwargs)  # 1. PostgreSQL enregistre et donne un id (ex. 7)
            if self.u_number is None:  # 2. seulement pour un nouveau dossier
                # 3. Le matricule vient de l'id : 7 -> "U000007" (6 chiffres).
                #    L'id ne revient jamais en arrière (même après une suppression),
                #    donc un matricule n'est jamais donné deux fois.
                self.u_number = f"U{self.pk:06d}"
                super().save(update_fields=["u_number"])

            # 4. Le compte suit le statut, mais SEULEMENT quand le statut change :
            #    -> "Sorti" : compte bloqué ; "Sorti" -> autre (réintégré, erreur corrigée) : débloqué.
            #    Modifier un téléphone ne débloque donc jamais un compte que l'IT a bloqué à la main.
            if self.user_id and self.status != old_status:
                if self.status == self.Status.LEFT:
                    set_account_active(self.user, False)
                elif old_status == self.Status.LEFT:
                    set_account_active(self.user, True)


class Child(models.Model):
    """Un enfant du collaborateur (allocations familiales CNSS).
    Supprimé avec le dossier (CASCADE) : il n'existe pas sans son parent."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="children", verbose_name="Collaborateur")
    first_name = models.CharField("Prénom", max_length=100)
    birth_date = models.DateField("Date de naissance", validators=[not_in_future])

    class Meta:
        verbose_name = "Enfant"
        ordering = ["birth_date"]  # du plus grand au plus petit

    def __str__(self):
        return f"{self.first_name} ({self.birth_date:%d/%m/%Y})"


class EmployeeHistory(models.Model):
    """L'historique d'un dossier : qui a fait quoi, et quand (une ligne par action).

    Écrit par employees/history.py (API, admin, "Mon profil"), jamais modifié ensuite.
    `changes` : la liste des champs changés, ex. [{"field": "Téléphone", "old": "0600...", "new": "0611..."}].
    Pour un champ secret (RIB, CNSS, CIMR) : {"field": "RIB", "hidden": true}, sans les numéros.
    """

    class Action(models.TextChoices):
        CREATED = "CREATED", "Création"
        UPDATED = "UPDATED", "Modification"
        ROLE = "ROLE", "Changement de rôle"
        PASSWORD_RESET = "PASSWORD_RESET", "Réinitialisation du mot de passe"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="history", verbose_name="Collaborateur")
    # Qui : le compte (SET_NULL : l'historique reste même si le compte disparaît un jour),
    # et son username recopié au moment de l'action.
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name="+", verbose_name="Fait par")
    actor_name = models.CharField("Fait par (username)", max_length=150)
    action = models.CharField("Action", max_length=20, choices=Action.choices)
    changes = models.JSONField("Changements", default=list, blank=True)
    created_at = models.DateTimeField("Date", auto_now_add=True)

    class Meta:
        verbose_name = "Historique"
        verbose_name_plural = "Historique"
        ordering = ["-created_at", "-id"]  # le plus récent d'abord

    def __str__(self):
        return f"{self.get_action_display()} - {self.employee} - {self.actor_name}"


class Notification(models.Model):
    """Une notification pour un RH : la cloche 🔔 en haut de l'écran (step G).

    Créée par employees/notifications.py quand le RH ouvre la cloche (pas besoin de programme
    qui tourne chaque nuit). Le texte n'est pas stocké : il est calculé à l'affichage
    ("dans 3 jours" change chaque jour).
    """

    class Kind(models.TextChoices):
        TRIAL_END = "TRIAL_END", "Fin de période d'essai"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications",
                                  verbose_name="Destinataire")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="+", verbose_name="Collaborateur")
    kind = models.CharField("Type", max_length=20, choices=Kind.choices)
    due_date = models.DateField("Date concernée")  # ex. la date de fin de la période d'essai
    created_at = models.DateTimeField("Créée le", auto_now_add=True)
    read_at = models.DateTimeField("Lue le", null=True, blank=True)  # vide = pas encore lue

    class Meta:
        verbose_name = "Notification"
        ordering = ["-created_at", "-id"]
        constraints = [
            # Une seule notification par RH, par collaborateur et par date : jamais de doublon,
            # même si la cloche est ouverte 50 fois.
            models.UniqueConstraint(fields=["recipient", "employee", "kind", "due_date"],
                                    name="employees_notification_unique"),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} - {self.employee} -> {self.recipient}"
