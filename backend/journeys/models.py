"""Arrivées et départs (2026-11-23, module "Nouvel arrivant" / "Départ collaborateur" de NOOR).

Le standard d'aujourd'hui (BambooHR, Workday, Personio) : une CHECKLIST de petites tâches, chacune avec
QUI la fait et QUAND, et pas un grand formulaire.
- TaskTemplate = le MODÈLE (Admin RH le change dans Reference lists, sans code) : "IT : préparer le PC,
  3 jours avant le premier jour". Une liste pour les arrivées, une pour les départs.
- Journey = le PARCOURS d'une personne (l'arrivée de Sara le 01/12) : une COPIE du modèle au moment où il
  commence (comme un circuit de demande : changer le modèle ne touche jamais un parcours en cours).
- JourneyTask = une tâche de ce parcours, avec une vraie date et une vraie personne.
Toutes les tâches avancent EN MÊME TEMPS (NOOR : "en cours de traitement par les différents services").
Les valeurs de départ sont une PROPOSITION standard, à valider par les RH.
"""
import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from employees.models import Employee


class Kind(models.TextChoices):
    ARRIVAL = "ARRIVAL", "Arrivée"
    DEPARTURE = "DEPARTURE", "Départ"


class Owner(models.TextChoices):
    """QUI fait la tâche : un RÔLE (comme les circuits), ou une personne choisie (ex. l'IT, le parc auto)."""
    HR = "HR", "RH du pôle"
    MANAGER = "MANAGER", "Manager (N+1)"
    EMPLOYEE = "EMPLOYEE", "Le collaborateur"
    PERSON = "PERSON", "Une personne choisie"


class TaskTemplate(models.Model):
    """Une ligne du modèle : "IT (Abdelghani) : préparer le PC, 3 jours avant le premier jour".
    Jamais supprimée : désactivée (comme les listes de référence)."""

    kind = models.CharField("Parcours", max_length=10, choices=Kind.choices)
    name = models.CharField("Tâche", max_length=150)
    owner = models.CharField("Qui la fait", max_length=10, choices=Owner.choices)
    # Seulement pour "Une personne choisie" (ex. le responsable IT, le parc auto).
    person = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="+",
                               verbose_name="Personne")
    # Le jour de la tâche, compté depuis le premier jour (arrivée) ou le dernier jour (départ) :
    # -3 = 3 jours avant, 0 = le jour même, 30 = un mois après.
    offset_days = models.SmallIntegerField("Jours (avant < 0 < après)", default=0,
                                           validators=[MinValueValidator(-90), MaxValueValidator(365)])
    # Une information à noter quand la tâche est faite (optionnel), ex. "Numéro de série du PC" (comme NOOR).
    detail_label = models.CharField("Information à noter", max_length=100, blank=True)
    is_active = models.BooleanField("Actif", default=True)

    class Meta:
        verbose_name = "Modèle de tâche"
        verbose_name_plural = "Modèles de tâches"
        ordering = ["kind", "offset_days", "id"]

    def __str__(self):
        return f"{self.get_kind_display()} : {self.name}"

    def clean(self):
        self.name = " ".join(self.name.split())
        if self.owner == Owner.PERSON:
            if self.person_id is None:
                raise ValidationError({"person": "Choisissez la personne qui fait cette tâche."})
            if self.person.status == Employee.Status.LEFT:
                raise ValidationError({"person": "Cette personne est sortie : choisissez quelqu'un d'autre."})
        else:
            self.person = None  # une personne seulement pour "Une personne choisie"


class Journey(models.Model):
    """Le parcours d'UNE personne : son arrivée, ou son départ. Un seul en cours par personne et par sorte."""

    kind = models.CharField("Parcours", max_length=10, choices=Kind.choices)
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="journeys", verbose_name="Collaborateur")
    # Arrivée : le premier jour (= la date d'embauche) ; départ : le dernier jour.
    day = models.DateField("Jour")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+", verbose_name="Commencé par")
    created_at = models.DateTimeField("Commencé le", auto_now_add=True)
    # Annulé (ex. la personne n'est finalement pas venue) : jamais supprimé, la trace reste.
    cancelled_at = models.DateTimeField("Annulé le", null=True, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+", verbose_name="Annulé par")
    cancel_reason = models.CharField("Motif d'annulation", max_length=300, blank=True)

    class Meta:
        verbose_name = "Parcours"
        verbose_name_plural = "Parcours"
        ordering = ["-day", "-id"]
        constraints = [
            # Une seule arrivée (et un seul départ) NON annulé par personne : jamais de doublon de tâches.
            models.UniqueConstraint(fields=["employee", "kind"], condition=Q(cancelled_at__isnull=True),
                                    name="journeys_one_open_per_employee"),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} de {self.employee} ({self.day:%d/%m/%Y})"


class JourneyTask(models.Model):
    """Une tâche du parcours : copiée du modèle, avec sa vraie date et sa vraie personne."""

    journey = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name="tasks", verbose_name="Parcours")
    name = models.CharField("Tâche", max_length=150)
    owner = models.CharField("Qui la fait", max_length=10, choices=Owner.choices)
    # La personne (manager, collaborateur, personne choisie) ; vide = les RH du pôle.
    person = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="+",
                               verbose_name="Personne")
    offset_days = models.SmallIntegerField("Jours (avant < 0 < après)", default=0)
    due_date = models.DateField("À faire avant le")
    detail_label = models.CharField("Information à noter", max_length=100, blank=True)
    # Rempli quand c'est fait.
    detail = models.CharField("Information notée", max_length=200, blank=True)
    comment = models.CharField("Commentaire", max_length=500, blank=True)
    done_at = models.DateTimeField("Faite le", null=True, blank=True)
    done_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name="+", verbose_name="Faite par")

    class Meta:
        verbose_name = "Tâche"
        ordering = ["due_date", "id"]

    def __str__(self):
        return self.name


# --- Départ collaborateur (step 2, 2026-11-23) -------------------------------------------------------

class DepartureType(models.TextChoices):
    RESIGNATION = "RESIGNATION", "Démission"
    END_OF_CONTRACT = "END_OF_CONTRACT", "Fin de contrat (CDD, intérim)"
    END_OF_TRIAL = "END_OF_TRIAL", "Fin de période d'essai"
    RETIREMENT = "RETIREMENT", "Retraite"
    DISMISSAL = "DISMISSAL", "Licenciement"
    MUTUAL = "MUTUAL", "Départ négocié"
    OTHER = "OTHER", "Autre"


# --- Le préavis (2026-11-25, Code du travail art. 43, décret n° 2-04-469) -------------------------------------
# La durée dépend du GROUPE (cadres et assimilés / employés et ouvriers) et de l'ANCIENNETÉ. La loi donne le minimum :
# le contrat, la convention collective ou le règlement intérieur peuvent donner plus. Admin RH change la grille.

class NoticeGroup(models.TextChoices):
    EXECUTIVE = "EXECUTIVE", "Cadres et assimilés"
    OTHER = "OTHER", "Employés et ouvriers"


class NoticeUnit(models.TextChoices):
    DAYS = "DAYS", "jours"
    MONTHS = "MONTHS", "mois"


class NoticeRule(models.Model):
    """Une case de la grille du préavis : ex. "Employés et ouvriers, à partir de 1 an d'ancienneté : 1 mois".
    3 lignes par groupe (moins d'un an, 1 à 5 ans, plus de 5 ans), valeurs de la loi par défaut (migration 0007)."""

    group = models.CharField("Groupe", max_length=10, choices=NoticeGroup.choices)
    min_years = models.PositiveSmallIntegerField("À partir de (années d'ancienneté)")
    amount = models.PositiveSmallIntegerField("Durée", validators=[MinValueValidator(1), MaxValueValidator(365)])
    unit = models.CharField("Unité", max_length=6, choices=NoticeUnit.choices)

    class Meta:
        verbose_name = "Préavis (grille)"
        verbose_name_plural = "Préavis (grille)"
        ordering = ["group", "min_years"]
        constraints = [models.UniqueConstraint("group", "min_years", name="journeys_notice_one_rule_per_step")]

    def __str__(self):
        return f"{self.get_group_display()}, dès {self.min_years} an(s) : {self.amount} {self.get_unit_display()}"


class NoticeStatus(models.TextChoices):
    """Ce que les RH retiennent pour le préavis (sert au solde de tout compte, fait par la paie)."""
    RESPECTED = "RESPECTED", "Respecté"
    WAIVED = "WAIVED", "Dispensé par l'employeur"
    NOT_RESPECTED = "NOT_RESPECTED", "Non respecté par le salarié"
    NONE = "NONE", "Pas de préavis pour ce type de départ"


def default_notice_types():
    """Les types de départ où le préavis s'applique, par défaut : démission et licenciement (art. 43)."""
    return [DepartureType.RESIGNATION.value, DepartureType.DISMISSAL.value]


def default_indemnity_hours():
    """Art. 53 : 96 h de salaire par année pour les 5 premières années, 144 h de la 6e à la 10e, 192 h de la 11e à la
    15e, 240 h au-delà (une fraction d'année compte au prorata). À vérifier par les RH / un juriste."""
    return [[0, 96], [5, 144], [10, 192], [15, 240]]


def letter_path(departure, filename):
    """media/departures/2026/11/<nom au hasard>.pdf : jamais le nom d'origine (il peut contenir n'importe quoi)."""
    return f"departures/{departure.created_at:%Y/%m}/{uuid.uuid4().hex}{os.path.splitext(filename)[1].lower()}"


class Departure(models.Model):
    """La DEMANDE de départ (NOOR "Départ collaborateur" -> "+ Créer") : saisie par le manager (N+1) ou les RH (le
    collaborateur lui-même seulement si Admin RH l'autorise, comme NOOR : "référez-vous à votre supérieur").
    C'est une demande du moteur (circuit "Départ collaborateur" : RH du pôle valident) ; une fois acceptée,
    le parcours de départ (les tâches) commence, et le dernier jour passé, le collaborateur devient "Sorti"."""

    request = models.OneToOneField("workflows.Request", on_delete=models.PROTECT, related_name="departure", verbose_name="Demande")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="departures", verbose_name="Collaborateur sortant")
    departure_type = models.CharField("Type de départ", max_length=20, choices=DepartureType.choices)
    last_day = models.DateField("Dernier jour")
    comment = models.CharField("Commentaire", max_length=500, blank=True)
    # La lettre (démission...) : PDF / JPG / PNG, 5 Mo ; jamais une adresse publique (API departures/<id>/letter/).
    letter = models.FileField("Lettre", upload_to=letter_path, blank=True)
    letter_name = models.CharField("Nom de la lettre", max_length=150, blank=True)
    # Les personnes à prévenir (NOOR) : une 🔔 "Pour information" quand le départ est validé.
    informed = models.ManyToManyField(Employee, blank=True, related_name="+", verbose_name="Personnes à prévenir")
    journey = models.OneToOneField(Journey, on_delete=models.SET_NULL, null=True, blank=True, related_name="departure",
                                   verbose_name="Parcours de départ")
    created_at = models.DateTimeField("Créée le", default=timezone.now)
    # Le préavis (2026-11-25) : une PHOTO prise à la demande (la grille peut changer après) ; les RH peuvent corriger
    # le début (ex. la date de la lettre) et décident du statut. Vide = pas de préavis pour ce type de départ.
    notice_group = models.CharField("Préavis : groupe", max_length=10, choices=NoticeGroup.choices, blank=True)
    notice_years = models.PositiveSmallIntegerField("Préavis : ancienneté (années)", null=True, blank=True)
    notice_amount = models.PositiveSmallIntegerField("Préavis : durée", null=True, blank=True)
    notice_unit = models.CharField("Préavis : unité", max_length=6, choices=NoticeUnit.choices, blank=True)
    notice_start = models.DateField("Préavis : début", null=True, blank=True)
    notice_until = models.DateField("Préavis : dernier jour au plus tôt", null=True, blank=True)
    # Vide = à décider par les RH (le dernier jour tombe avant la fin du préavis).
    notice_status = models.CharField("Préavis : statut", max_length=15, choices=NoticeStatus.choices, blank=True)
    notice_decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                          related_name="+", verbose_name="Préavis : décidé par")
    notice_decided_at = models.DateTimeField("Préavis : décidé le", null=True, blank=True)
    # La procédure complète (2026-11-25, Code du travail) :
    # - licenciement pour FAUTE GRAVE (art. 39) : ni préavis, ni indemnité de licenciement ;
    serious_misconduct = models.BooleanField("Faute grave", default=False)
    # - la lettre de démission ORIGINALE (écrite, signée, signature légalisée : art. 34) reçue par les RH ;
    letter_original_at = models.DateTimeField("Lettre originale reçue le", null=True, blank=True)
    letter_original_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                           related_name="+", verbose_name="Lettre originale reçue par")
    # - les documents de sortie (certificat de travail en 8 jours, art. 72 ; reçu pour solde de tout compte, art. 73),
    #   demandés tout seuls à la validation, dans le module Documents (une demande, un document par type).
    exit_request = models.OneToOneField("workflows.Request", on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name="+", verbose_name="Documents de sortie")

    @property
    def notice_short_days(self):
        """Combien de jours manquent au préavis (le dernier jour avant la fin du préavis), sinon 0."""
        if self.notice_until is None or self.last_day >= self.notice_until:
            return 0
        return (self.notice_until - self.last_day).days

    class Meta:
        verbose_name = "Demande de départ"
        verbose_name_plural = "Demandes de départ"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Départ de {self.employee} ({self.last_day:%d/%m/%Y})"


# --- L'entretien de sortie (2026-11-25, standard : savoir POURQUOI les gens partent) -------------------------------

class QuestionKind(models.TextChoices):
    TEXT = "TEXT", "Texte libre"
    RATING = "RATING", "Note de 1 à 5"
    CHOICE = "CHOICE", "Un choix dans une liste"
    YES_NO = "YES_NO", "Oui / Non"


class ExitQuestion(models.Model):
    """Une question de l'entretien de sortie (Admin RH : Réglages des arrivées et départs -> Exit interview).
    Jamais supprimée : décochée (les réponses passées gardent leur question, elles en ont une copie)."""

    text = models.CharField("Question", max_length=200)
    kind = models.CharField("Type de réponse", max_length=6, choices=QuestionKind.choices, default=QuestionKind.TEXT)
    choices = models.JSONField("Choix (pour « un choix »)", default=list, blank=True)
    required = models.BooleanField("Obligatoire", default=False)
    order = models.PositiveSmallIntegerField("Ordre", default=0)
    is_active = models.BooleanField("Active", default=True)

    class Meta:
        verbose_name = "Question de l'entretien de sortie"
        verbose_name_plural = "Questions de l'entretien de sortie"
        ordering = ["order", "id"]

    def __str__(self):
        return self.text

    def clean(self):
        if self.kind == QuestionKind.CHOICE and len([c for c in self.choices if str(c).strip()]) < 2:
            raise ValidationError({"choices": "Donnez au moins 2 choix."})


class ExitInterview(models.Model):
    """Les réponses d'UN départ. CONFIDENTIEL : le collaborateur et les RH de son pôle, jamais le manager (il peut être
    la raison du départ). `questions` = une COPIE des questions au moment de répondre (le modèle peut changer après)."""

    departure = models.OneToOneField(Departure, on_delete=models.CASCADE, related_name="exit_interview", verbose_name="Départ")
    questions = models.JSONField("Questions (copie)", default=list)
    answers = models.JSONField("Réponses", default=dict)
    filled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name="+", verbose_name="Rempli par")
    filled_at = models.DateTimeField("Rempli le", null=True, blank=True)

    class Meta:
        verbose_name = "Entretien de sortie"
        verbose_name_plural = "Entretiens de sortie"

    def __str__(self):
        return f"Entretien de sortie de {self.departure.employee}"


class JourneySettings(models.Model):
    """Les réglages (une seule ligne, Admin RH) : Reference lists -> Arrivées et départs -> Departure requests."""

    # Comme NOOR par défaut : NON, le collaborateur passe par son manager (ou les RH).
    employee_can_request_departure = models.BooleanField("Le collaborateur peut demander son propre départ", default=False)
    # Le compte à la fin (2026-11-24, choix d'Admin RH) : OUI par défaut = le lendemain du dernier jour, l'app met
    # "Sorti" et bloque le compte (sécurité). NON = les RH le font à la main ; l'app leur envoie alors une 🔔 + email
    # "Compte à bloquer" chaque matin, tant que ce n'est pas fait (pour ne jamais l'oublier).
    auto_block = models.BooleanField("Bloquer le compte automatiquement le lendemain du dernier jour", default=True)
    # Le préavis (2026-11-25) : les catégories du groupe "cadres et assimilés" (les autres = employés et ouvriers),
    # et les types de départ où il s'applique (démission et licenciement par défaut).
    executive_categories = models.ManyToManyField("employees.Category", blank=True, related_name="+",
                                                  verbose_name="Catégories cadres et assimilés (préavis)")
    notice_types = models.JSONField("Types de départ avec préavis", default=default_notice_types, blank=True)
    # La procédure complète (2026-11-25) :
    # - une démission demande la lettre (écrite, signée, légalisée : art. 34) jointe au formulaire ;
    letter_required = models.BooleanField("Lettre obligatoire pour une démission", default=True)
    # - l'indemnité de licenciement (art. 52-53) en HEURES de salaire par année d'ancienneté (la paie la transforme en
    #   argent) : [[à partir de (années), heures par an], ...] et le minimum d'ancienneté (6 mois) ;
    indemnity_hours = models.JSONField("Indemnité de licenciement (heures par an)", default=default_indemnity_hours, blank=True)
    indemnity_min_months = models.PositiveSmallIntegerField("Indemnité : ancienneté minimum (mois)", default=6)
    # - les documents de sortie demandés tout seuls à la validation du départ, prêts au plus tard N jours après le
    #   dernier jour (certificat de travail : 8 jours, art. 72).
    exit_document_types = models.ManyToManyField("documents.DocumentType", blank=True, related_name="+",
                                                 verbose_name="Documents de sortie")
    exit_document_days = models.PositiveSmallIntegerField("Documents de sortie : jours après le dernier jour", default=8)
    updated_at = models.DateTimeField("Modifié le", auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+", verbose_name="Modifié par")

    class Meta:
        verbose_name = "Réglages des arrivées et départs"
        verbose_name_plural = "Réglages des arrivées et départs"

    def __str__(self):
        return "Réglages des arrivées et départs"

    @classmethod
    def load(cls):
        current, _ = cls.objects.get_or_create(pk=1)
        return current
