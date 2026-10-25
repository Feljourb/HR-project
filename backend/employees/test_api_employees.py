"""Tests de l'API des collaborateurs (step 5)."""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from . import services
from .models import Department, Employee
from .tests import EmployeeTestCase

User = get_user_model()
LIST_URL = reverse("employees:employee-list")
ME_URL = reverse("employees:employee-me")


def detail_url(employee):
    return reverse("employees:employee-detail", args=[employee.pk])


class EmployeesApiTests(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        # Un service et un poste du pôle Riaya (entité Eureka).
        self.production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        self.operator = self.production.positions.get(name="Opérateur de production")
        # Deux collaborateurs : un dans chaque pôle.
        self.sbd_employee = self.saved("AB000001", first_name="Karim")
        self.riaya_employee = self.saved("AB000002", first_name="Salma",
                                         department=self.production, position=self.operator)

    def saved(self, cin, role=None, **fields):
        """Un dossier enregistré avec son compte (prêt : mot de passe déjà changé)."""
        employee = services.create_with_account(self.fiche(cin, **fields), role=role)
        employee.user.must_change_password = False
        employee.user.save()
        return employee

    def login_hr_sbd(self):
        hr = self.saved("HR000001", role=User.Role.HR, first_name="Rh")  # dossier dans Challenge (SBD)
        self.client.force_authenticate(hr.user)
        return hr

    def login_as(self, role):
        user = User.objects.create_user(f"user.{role.lower()}", role=role, must_change_password=False)
        self.client.force_authenticate(user)
        return user

    def payload(self, cin, **fields):
        """Le JSON qu'envoie le formulaire : les listes sont des numéros (id)."""
        fiche = self.fiche(cin)
        data = {
            "title": fiche.title, "last_name": "Bennani", "first_name": "Sara", "birth_date": "1995-03-10",
            "cin": cin, "city": fiche.city, "address": fiche.address, "phone": fiche.phone,
            "professional_email": "sara.bennani@sbd.ma", "marital_status": fiche.marital_status,
            "department": self.sales.pk, "position": self.salesman.pk,
            "assignment": fiche.assignment.pk, "category": fiche.category.pk,
            "contract_type": fiche.contract_type.pk, "region": fiche.region.pk,
            "work_location": fiche.work_location, "hire_date": "2026-01-05",
        }
        return {**data, **fields}

    # --- Qui a accès ------------------------------------------------------------

    def test_anonymous_and_collaborators_are_refused(self):
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)
        self.login_as(User.Role.COLLABORATOR)
        self.assertEqual(self.client.get(LIST_URL).status_code, 403)
        self.login_as(User.Role.MANAGER)
        self.assertEqual(self.client.get(LIST_URL).status_code, 403)

    def test_hr_only_sees_their_pole(self):
        self.login_hr_sbd()
        names = [row["first_name"] for row in self.client.get(LIST_URL).json()["results"]]
        self.assertIn("Karim", names)
        self.assertNotIn("Salma", names)  # Riaya
        self.assertEqual(self.client.get(detail_url(self.riaya_employee)).status_code, 404)

    def test_hr_admin_sees_both_poles(self):
        self.login_as(User.Role.HR_ADMIN)
        names = [row["first_name"] for row in self.client.get(LIST_URL).json()["results"]]
        self.assertIn("Karim", names)
        self.assertIn("Salma", names)

    def test_list_rows_have_readable_names(self):
        self.login_as(User.Role.HR_ADMIN)
        row = self.client.get(LIST_URL, {"search": "karim"}).json()["results"][0]
        self.assertEqual(row["position"], "Commercial terrain")
        self.assertEqual(row["direction"], "Direction Commerciale")
        self.assertEqual(row["entity"], "Challenge")
        self.assertEqual(row["status_label"], "Actif")

    def test_search_and_filters(self):
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.get(LIST_URL, {"search": "AB000002"}).json()["count"], 1)  # par CIN
        eureka = self.production.direction.entity
        rows = self.client.get(LIST_URL, {"entity": eureka.pk}).json()["results"]
        self.assertEqual([row["first_name"] for row in rows], ["Salma"])
        self.assertEqual(self.client.get(LIST_URL, {"entity": "abc"}).status_code, 400)

    # --- Créer ---------------------------------------------------------------------

    def test_hr_creates_a_collaborator_with_account(self):
        self.login_hr_sbd()
        response = self.client.post(LIST_URL, self.payload("cd987654"), format="json")

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["username"], "sara.bennani")
        self.assertRegex(data["u_number"], r"^U\d{6}$")
        user = Employee.objects.get(pk=data["id"]).user
        self.assertTrue(user.check_password("CD987654"))
        self.assertEqual(user.role, User.Role.COLLABORATOR)

    def test_create_like_the_frontend_form(self):
        """Le formulaire envoie tous les champs : les vides en null, les ids en texte."""
        self.login_hr_sbd()
        empty = dict.fromkeys(["temp_agency", "grade", "division", "cost_center", "manager",
                               "trial_end_date", "onboarding_end_date", "departure_date"])
        payload = self.payload("CD987654", country="Maroc", status="ACTIVE", initial_leave_balance="0",
                               role="COLLABORATOR", department=str(self.sales.pk), position=str(self.salesman.pk), **empty)
        response = self.client.post(LIST_URL, payload, format="json")
        self.assertEqual(response.status_code, 201, response.json())

    def test_hr_cannot_create_in_the_other_pole(self):
        self.login_hr_sbd()
        response = self.client.post(
            LIST_URL, self.payload("CD987654", department=self.production.pk, position=self.operator.pk), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("department", response.json())

    def test_model_rules_give_a_clear_400(self):
        self.login_hr_sbd()
        response = self.client.post(LIST_URL, self.payload("CD987654", position=self.operator.pk), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["position"], ["Ce poste n'appartient pas au service choisi."])

    def test_only_hr_admin_gives_an_hr_role(self):
        self.login_hr_sbd()
        response = self.client.post(LIST_URL, self.payload("CD987654", role="HR_ADMIN"), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("role", response.json())

        self.login_as(User.Role.HR_ADMIN)
        response = self.client.post(LIST_URL, self.payload("CD987654", role="HR"), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username=response.json()["username"]).role, User.Role.HR)

    # --- Modifier ------------------------------------------------------------------

    def test_hr_updates_but_cannot_move_to_the_other_pole(self):
        self.login_hr_sbd()
        url = detail_url(self.sbd_employee)
        self.assertEqual(self.client.patch(url, {"phone": "0611111111"}, format="json").status_code, 200)

        response = self.client.patch(url, {"department": self.production.pk, "position": self.operator.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.sbd_employee.refresh_from_db()
        self.assertEqual(self.sbd_employee.department, self.sales)

    def test_fiche_shows_the_manager_name(self):
        self.login_hr_sbd()
        self.sbd_employee.manager = self.riaya_employee  # manager d'un autre pôle
        self.sbd_employee.save()
        data = self.client.get(detail_url(self.sbd_employee)).json()
        self.assertEqual(data["manager"], self.riaya_employee.pk)
        self.assertEqual(data["manager_label"], str(self.riaya_employee))

    def test_no_delete(self):
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.delete(detail_url(self.sbd_employee)).status_code, 405)

    # --- Mon dossier (/me/) ----------------------------------------------------------

    def test_collaborator_reads_their_own_fiche(self):
        self.client.force_authenticate(self.sbd_employee.user)
        response = self.client.get(ME_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["u_number"], self.sbd_employee.u_number)

    def test_collaborator_only_changes_personal_fields(self):
        self.client.force_authenticate(self.sbd_employee.user)
        response = self.client.patch(ME_URL, {"phone": "0622222222", "last_name": "Pirate"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.sbd_employee.refresh_from_db()
        self.assertEqual(self.sbd_employee.phone, "0622222222")  # champ personnel : changé
        self.assertEqual(self.sbd_employee.last_name, "Alami")  # champ RH : ignoré

    def test_me_without_fiche_is_404(self):
        self.login_as(User.Role.COLLABORATOR)
        self.assertEqual(self.client.get(ME_URL).status_code, 404)
