"""Tests du dossier administratif, du contact d'urgence et des enfants (step D)."""
import datetime

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse
from rest_framework.test import APIClient

from . import services
from .models import Bank, Employee
from .tests import EmployeeTestCase

User = get_user_model()
RIB = "0117 8000 0001 2345 6789 0123"  # 24 chiffres, avec des espaces comme sur un relevé


class AdministrativeFileModelTests(EmployeeTestCase):
    def check(self, cin="AB111111", **fields):
        """Vérifie une fiche (sans compte) : lève ValidationError si une règle est cassée."""
        self.fiche(cin, **fields).full_clean(exclude=["user"])

    def errors_of(self, **fields):
        with self.assertRaises(ValidationError) as error:
            self.check(**fields)
        return error.exception.message_dict

    def test_everything_is_optional(self):
        self.check(marital_status="")  # même la situation familiale (fiche RH)

    def test_rib_is_24_digits_and_goes_with_a_bank(self):
        bank = Bank.objects.get(name="CIH Bank")
        self.check(rib=RIB, bank=bank)  # OK, espaces acceptés
        self.assertIn("rib", self.errors_of(rib="0117 8000", bank=bank))  # trop court
        self.assertIn("bank", self.errors_of(rib=RIB))  # pas de banque

    def test_rib_is_stored_without_spaces(self):
        employee = self.make_employee("a.alami", "AB111111", rib=RIB, bank=Bank.objects.get(name="CIH Bank"))
        employee.refresh_from_db()
        self.assertEqual(employee.rib, "011780000001234567890123")

    def test_cnss_digits_only_and_unique_when_filled(self):
        self.assertIn("cnss_number", self.errors_of(cnss_number="12A456789"))
        self.make_employee("a.alami", "AB111111", cnss_number="123456789")
        errors = self.errors_of(cin="AB222222", cnss_number="123 456 789")  # le même, avec des espaces
        self.assertEqual(errors["cnss_number"], ["Ce numéro CNSS existe déjà."])
        # Deux dossiers SANS CNSS : permis (unique seulement quand c'est rempli).
        self.make_employee("b.bennani", "AB333333")
        self.make_employee("c.chraibi", "AB444444")

    def test_emergency_contact_needs_name_and_phone(self):
        self.assertIn("emergency_contact_phone", self.errors_of(emergency_contact_name="Fatima Alami"))
        self.assertIn("emergency_contact_name", self.errors_of(emergency_contact_phone="0611111111"))
        self.check(emergency_contact_name="Fatima Alami", emergency_contact_phone="0611111111",
                   emergency_contact_relationship=Employee.Relationship.SPOUSE)

    def test_names_are_cleaned(self):
        employee = self.make_employee("a.alami", "AB111111", last_name="  el   alami ", first_name="fatima  ezzahra")
        self.assertEqual(employee.last_name, "EL ALAMI")
        self.assertEqual(employee.first_name, "Fatima Ezzahra")


class ChildrenApiTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        hr = services.create_with_account(self.fiche("HR000001", first_name="Rh"), role=User.Role.HR)
        hr.user.must_change_password = False
        hr.user.save()
        self.client.force_authenticate(hr.user)  # RH de SBD
        self.karim = self.make_employee("k.karim", "AB000001", first_name="Karim")
        self.url = reverse("employees:employee-detail", args=[self.karim.pk])

    def test_children_list_replaces_the_old_one_and_is_counted(self):
        two = [{"first_name": "Yasmine", "birth_date": "2018-04-02"}, {"first_name": "Adam", "birth_date": "2021-09-15"}]
        response = self.client.patch(self.url, {"children": two}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["number_of_children"], 2)

        response = self.client.patch(self.url, {"children": two[:1]}, format="json")  # on retire Adam
        self.assertEqual([child["first_name"] for child in response.json()["children"]], ["Yasmine"])

    def test_patch_without_children_keeps_them(self):
        self.client.patch(self.url, {"children": [{"first_name": "Yasmine", "birth_date": "2018-04-02"}]}, format="json")
        response = self.client.patch(self.url, {"phone": "0622222222"}, format="json")
        self.assertEqual(response.json()["number_of_children"], 1)

    def test_birth_date_in_the_future_is_refused(self):
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        response = self.client.patch(self.url, {"children": [{"first_name": "X", "birth_date": tomorrow}]}, format="json")
        self.assertEqual(response.status_code, 400)
        # DRF range les erreurs d'une liste par position : {"children": {"0": {"birth_date": [...]}}}.
        self.assertEqual(response.json()["children"]["0"]["birth_date"], ["Cette date est dans le futur."])

    def test_collaborator_edits_their_emergency_contact_but_not_the_rest(self):
        user = self.karim.user
        user.must_change_password = False
        user.save()
        self.client.force_authenticate(user)
        response = self.client.patch(reverse("employees:employee-me"), {
            "emergency_contact_name": "Fatima Alami", "emergency_contact_phone": "0611111111",
            "rib": "011780000001234567890123", "children": [{"first_name": "X", "birth_date": "2020-01-01"}],
        }, format="json")

        self.assertEqual(response.status_code, 200, response.json())
        self.karim.refresh_from_db()
        self.assertEqual(self.karim.emergency_contact_name, "Fatima Alami")  # personnel : changé
        self.assertEqual(self.karim.rib, "")  # RH seulement : ignoré
        self.assertEqual(self.karim.children.count(), 0)  # RH seulement : ignoré
