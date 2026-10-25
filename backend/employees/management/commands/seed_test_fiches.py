"""Crée les dossiers RH des comptes de test, pour essayer l'API et le frontend.

    make seed   (ou : docker compose exec backend python manage.py seed_test_fiches)

- Seulement en développement (DEBUG=True) : ces données ne doivent jamais aller en production.
- On peut le relancer sans risque : un compte qui a déjà un dossier est ignoré.
- Les mots de passe des comptes existants ne sont pas modifiés.
"""
import datetime

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from employees.models import Assignment, Category, ContractType, Employee, Position, Region

# Mot de passe du seul compte créé ici (riaya.test), le même que les autres comptes de test.
TEST_PASSWORD = "Sbd-Test-2026!"

# username -> (rôle, nom, prénom, CIN, entité, service, poste, username du manager)
# L'ordre compte : un manager doit avoir son dossier avant son équipe.
FICHES = {
    "hr.test": ("HR", "Test", "RH", "TS000001", "Silent Believers Distribution",
                "Développement RH", "Chargé(e) de recrutement", None),
    "manager.test": ("MANAGER", "Test", "Manager", "TS000002", "Silent Believers Distribution",
                     "Ventes", "Chef des ventes", None),
    "collab.test": ("COLLABORATOR", "Test", "Collab", "TS000003", "Silent Believers Distribution",
                    "Ventes", "Commercial terrain", "manager.test"),
    # Un collaborateur du pôle Riaya : le RH de SBD ne doit PAS le voir.
    "riaya.test": ("COLLABORATOR", "Test", "Riaya", "TS000004", "Eureka",
                   "Production", "Opérateur de production", None),
}


class Command(BaseCommand):
    help = "Crée les dossiers RH des comptes de test (développement seulement)."

    @transaction.atomic  # tout ou rien
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Réservé au développement (DEBUG=True).")

        User = get_user_model()
        for username, (role, last, first, cin, entity, service, poste, manager) in FICHES.items():
            # Le compte : on le crée seulement s'il n'existe pas (cas de riaya.test).
            user = User.objects.filter(username=username).first()
            if user is None:
                user = User.objects.create_user(username, password=TEST_PASSWORD, role=role, must_change_password=False)
            if Employee.objects.filter(user=user).exists():
                self.stdout.write(f"- {username} : dossier déjà présent, ignoré")
                continue

            # Le poste donne aussi le service (le poste appartient à un seul service).
            position = Position.objects.get(
                name=poste, department__name=service, department__direction__entity__name=entity)
            employee = Employee(
                user=user, title=Employee.Title.MR, last_name=last, first_name=first,
                birth_date=datetime.date(1990, 1, 1), cin=cin, city="Casablanca", address="Adresse de test",
                phone="0600000000", professional_email=f"{username}@sbd.ma",
                marital_status=Employee.MaritalStatus.SINGLE,
                department=position.department, position=position,
                assignment=Assignment.objects.get(name="HQ"), category=Category.objects.get(name="Employé"),
                contract_type=ContractType.objects.get(name="CDI"), region=Region.objects.get(name="Casablanca-Settat"),
                work_location="Casablanca", hire_date=datetime.date(2025, 1, 6),
                manager=Employee.objects.get(user__username=manager) if manager else None,
            )
            employee.full_clean()  # les mêmes règles que partout ailleurs
            employee.save()
            self.stdout.write(self.style.SUCCESS(f"+ {username} : {employee.u_number}, {entity} › {service} › {poste}"))
