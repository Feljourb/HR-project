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

    class Meta:
        verbose_name = "Demande de départ"
        verbose_name_plural = "Demandes de départ"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Départ de {self.employee} ({self.last_day:%d/%m/%Y})"


class JourneySettings(models.Model):
    """Les réglages (une seule ligne, Admin RH) : Reference lists -> Arrivées et départs -> Departure requests."""

    # Comme NOOR par défaut : NON, le collaborateur passe par son manager (ou les RH).
    employee_can_request_departure = models.BooleanField("Le collaborateur peut demander son propre départ", default=False)
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
