"""Tests de l'API des listes (step 4)."""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from . import services
from .models import Department, Entity, Position
from .tests import EmployeeTestCase

User = get_user_model()


def url(name, pk=None):
    """Adresse d'une liste, ex. url("positions") ou url("positions", 12)."""
    if pk is None:
        return reverse(f"employees:{name}-list")
    return reverse(f"employees:{name}-detail", args=[pk])


class ListsApiTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def login_as(self, role, fiche=None):
        """Connecte un utilisateur prêt (mot de passe déjà changé) avec ce rôle.
        `fiche` : son dossier RH, nécessaire pour connaître le pôle d'un RH."""
        if fiche is not None:
            user = services.create_with_account(fiche, role=role).user
        else:
            user = User.objects.create_user(f"user.{role.lower()}", role=role)
        user.must_change_password = False
        user.save()
        self.client.force_authenticate(user)
        return user

    def names(self, response):
        return sorted(item["name"] for item in response.json())

    # --- Lecture ---------------------------------------------------------------

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(url("banks")).status_code, 401)

    def test_every_logged_in_user_can_read_the_lists(self):
        self.login_as(User.Role.COLLABORATOR)
        response = self.client.get(url("contract-types"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.names(response), ["CDD", "CDI", "Intérimaire", "Stagiaire"])

    def test_cascade_filter_by_parent(self):
        self.login_as(User.Role.COLLABORATOR)
        response = self.client.get(url("positions"), {"department": self.sales.pk})
        self.assertEqual(self.names(response), sorted(self.sales.positions.values_list("name", flat=True)))

    def test_invalid_parent_is_a_clear_error(self):
        self.login_as(User.Role.COLLABORATOR)
        self.assertEqual(self.client.get(url("positions"), {"department": "abc"}).status_code, 400)

    def test_inactive_values_are_hidden_from_forms(self):
        Position.objects.filter(pk=self.salesman.pk).update(is_active=False)
        self.login_as(User.Role.COLLABORATOR)
        response = self.client.get(url("positions"), {"department": self.sales.pk, "all": "1"})
        self.assertNotIn("Commercial terrain", self.names(response))  # ?all=1 ignoré pour un collaborateur

    def test_hr_admin_can_see_inactive_values_with_all(self):
        Position.objects.filter(pk=self.salesman.pk).update(is_active=False)
        self.login_as(User.Role.HR_ADMIN)
        response = self.client.get(url("positions"), {"department": self.sales.pk, "all": "1"})
        self.assertIn("Commercial terrain", self.names(response))

    # --- Pôle du RH -------------------------------------------------------------

    def test_hr_only_sees_the_entities_of_their_pole(self):
        self.login_as(User.Role.HR, fiche=self.fiche("AB111111"))  # dossier dans Challenge (SBD)
        self.assertEqual(self.names(self.client.get(url("entities"))), ["Challenge", "Silent Believers Distribution"])
        self.assertEqual(self.names(self.client.get(url("poles"))), ["SBD"])

    def test_hr_cannot_read_the_organisation_of_the_other_pole(self):
        self.login_as(User.Role.HR, fiche=self.fiche("AB111111"))  # RH SBD
        eureka = Entity.objects.get(name="Eureka")  # entité de Riaya
        self.assertEqual(self.client.get(url("directions"), {"entity": eureka.pk}).json(), [])

    def test_hr_without_fiche_sees_no_entity(self):
        self.login_as(User.Role.HR)
        self.assertEqual(self.client.get(url("entities")).json(), [])

    def test_hr_admin_sees_both_poles(self):
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(len(self.client.get(url("entities")).json()), 5)

    # --- Écriture : Admin RH seulement --------------------------------------------

    def test_hr_cannot_add_a_value(self):
        self.login_as(User.Role.HR, fiche=self.fiche("AB111111"))
        self.assertEqual(self.client.post(url("banks"), {"name": "Nouvelle Banque"}).status_code, 403)

    def test_hr_admin_adds_renames_and_deactivates(self):
        self.login_as(User.Role.HR_ADMIN)
        created = self.client.post(url("positions"), {"name": "Vendeur", "department": self.sales.pk})
        self.assertEqual(created.status_code, 201)
        pk = created.json()["id"]

        renamed = self.client.patch(url("positions", pk), {"name": "Vendeur confirmé"})
        self.assertEqual(renamed.json()["name"], "Vendeur confirmé")

        deactivated = self.client.patch(url("positions", pk), {"is_active": False})
        self.assertEqual(deactivated.status_code, 200)
        self.assertFalse(Position.objects.get(pk=pk).is_active)

    def test_duplicate_is_a_400_with_a_clear_message(self):
        self.login_as(User.Role.HR_ADMIN)
        response = self.client.post(url("assignments"), {"name": "field"})  # "Field" existe déjà
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["non_field_errors"], ["Cette valeur existe déjà."])

    def test_same_department_name_allowed_in_another_direction(self):
        self.login_as(User.Role.HR_ADMIN)
        other_direction = Department.objects.get(name="Entreposage", direction__entity__name="Challenge").direction
        response = self.client.post(url("departments"), {"name": "Ventes", "direction": other_direction.pk})
        self.assertEqual(response.status_code, 201)

    def test_a_used_value_is_never_deleted(self):
        self.make_employee("k.karim", "AB000001")  # utilise le poste "Commercial terrain"
        self.login_as(User.Role.HR_ADMIN)
        response = self.client.delete(url("positions", self.salesman.pk))
        self.assertEqual(response.status_code, 400)
        self.assertIn("désactivez-la", response.json()["non_field_errors"][0])
        self.assertTrue(Position.objects.filter(pk=self.salesman.pk).exists())

    def test_a_parent_with_children_is_never_deleted(self):
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.delete(url("departments", self.sales.pk)).status_code, 400)  # a des postes

    def test_an_unused_value_is_deleted(self):
        wrong = Position.objects.create(name="Poste en trop", department=self.sales)
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.delete(url("positions", wrong.pk)).status_code, 204)
        self.assertFalse(Position.objects.filter(pk=wrong.pk).exists())

    def test_only_hr_admin_deletes(self):
        wrong = Position.objects.create(name="Poste en trop", department=self.sales)
        self.login_as(User.Role.COLLABORATOR)
        self.assertEqual(self.client.delete(url("positions", wrong.pk)).status_code, 403)
        self.assertTrue(Position.objects.filter(pk=wrong.pk).exists())
