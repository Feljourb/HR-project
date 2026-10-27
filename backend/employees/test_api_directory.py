"""Tests de l'annuaire (step A)."""
import datetime

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from . import services
from .models import Department, Employee
from .tests import EmployeeTestCase

User = get_user_model()
DIRECTORY_URL = reverse("employees:directory-list")

# Exactement les champs publics de CLAUDE.md (+ l'id) : rien d'autre ne doit sortir.
PUBLIC_FIELDS = {"id", "last_name", "first_name", "position", "department", "direction", "professional_email", "phone"}


class DirectoryApiTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        self.karim = self.saved("AB000001", first_name="Karim")  # SBD
        self.salma = self.saved("AB000002", first_name="Salma", department=production,  # Riaya
                                position=production.positions.get(name="Opérateur de production"))
        self.youssef = self.saved("AB000003", first_name="Youssef", status=Employee.Status.LEFT,
                                  departure_date=datetime.date(2026, 6, 30))  # sorti

    def saved(self, cin, **fields):
        employee = services.create_with_account(self.fiche(cin, **fields))
        employee.user.must_change_password = False
        employee.user.save()
        return employee

    def names(self, response):
        return sorted(row["first_name"] for row in response.json()["results"])

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(DIRECTORY_URL).status_code, 401)

    def test_a_collaborator_sees_both_poles(self):
        self.client.force_authenticate(self.karim.user)  # collaborateur de SBD
        response = self.client.get(DIRECTORY_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.names(response), ["Karim", "Salma"])  # Salma est dans Riaya

    def test_only_public_fields(self):
        self.client.force_authenticate(self.karim.user)
        row = self.client.get(DIRECTORY_URL).json()["results"][0]
        self.assertEqual(set(row), PUBLIC_FIELDS)  # pas de CIN, d'adresse, de contrat...
        self.assertEqual(row["direction"], "Direction Commerciale")

    def test_left_employees_are_hidden(self):
        self.client.force_authenticate(self.karim.user)
        self.assertNotIn("Youssef", self.names(self.client.get(DIRECTORY_URL)))

    def test_search_by_name_or_service(self):
        self.client.force_authenticate(self.karim.user)
        self.assertEqual(self.names(self.client.get(DIRECTORY_URL, {"search": "salma"})), ["Salma"])
        self.assertEqual(self.names(self.client.get(DIRECTORY_URL, {"search": "production"})), ["Salma"])

    def test_read_only(self):
        self.client.force_authenticate(self.karim.user)
        self.assertEqual(self.client.post(DIRECTORY_URL, {"first_name": "X"}).status_code, 405)

    def test_account_not_ready_is_blocked(self):
        user = self.karim.user
        user.must_change_password = True  # mot de passe temporaire pas encore changé
        user.save()
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get(DIRECTORY_URL).status_code, 403)
