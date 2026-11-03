"""Tests de l'API des collaborateurs (step 5)."""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from . import services
from .models import Department, Employee, Pole
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
            "cin": cin, "city": fiche.city.pk, "address": fiche.address, "phone": fiche.phone,
            "marital_status": fiche.marital_status,  # pas d'email : Django le crée
            "department": self.sales.pk, "position": self.salesman.pk,
            "assignment": fiche.assignment.pk, "category": fiche.category.pk, "grade": fiche.grade.pk,
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
        empty = dict.fromkeys(["temp_agency", "division", "cost_center", "bank",
                               "trial_end_date", "onboarding_end_date", "departure_date"])
        # Les textes optionnels vides arrivent en "" (pas null), et les enfants en liste.
        empty.update(dict.fromkeys(["cnss_number", "cimr_number", "rib", "emergency_contact_name",
                                    "emergency_contact_relationship", "emergency_contact_phone"], ""), children=[])
        payload = self.payload("CD987654", country="Maroc", status="ACTIVE", annual_leave_days="0",
                               role="COLLABORATOR", department=str(self.sales.pk), position=str(self.salesman.pk), **empty)
        response = self.client.post(LIST_URL, payload, format="json")
        self.assertEqual(response.status_code, 201, response.json())

    # --- Email professionnel automatique (K2) ------------------------------------------

    def test_email_is_created_from_the_name_and_the_pole(self):
        self.login_as(User.Role.HR_ADMIN)
        # Pas d'email envoyé (le RH a gardé la proposition) : Django le crée.
        first = self.client.post(LIST_URL, self.payload("CD987654"), format="json")
        self.assertEqual(first.status_code, 201, first.json())
        self.assertEqual(first.json()["professional_email"], "s.bennani@silent-believers.com")
        self.assertEqual(User.objects.get(username="sara.bennani").email, "s.bennani@silent-believers.com")

        # Même initiale + même nom : un numéro, comme pour le nom de connexion.
        second = self.client.post(LIST_URL, self.payload("CD111111", first_name="Samir"), format="json")
        self.assertEqual(second.json()["professional_email"], "s.bennani2@silent-believers.com")

        # Pôle Riaya : son propre domaine.
        riaya = self.client.post(LIST_URL, self.payload(
            "CD222222", first_name="Hajar", last_name="El Idrissi",
            department=self.production.pk, position=self.operator.pk), format="json")
        self.assertEqual(riaya.json()["professional_email"], "h.el-idrissi@riaya-industries.com")

    def test_hr_can_change_the_proposed_email(self):
        self.login_hr_sbd()
        response = self.client.post(LIST_URL, self.payload("CD987654", professional_email="sara.bennani@silent-believers.com"), format="json")
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["professional_email"], "sara.bennani@silent-believers.com")

    def test_email_of_a_colleague_is_refused(self):
        self.login_hr_sbd()
        taken = self.sbd_employee.professional_email
        response = self.client.post(LIST_URL, self.payload("CD987654", professional_email=taken.upper()), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["professional_email"], ["Cet email est déjà utilisé par un autre collaborateur."])
        # Son propre email : toujours permis (modifier une fiche sans toucher à l'email).
        response = self.client.patch(detail_url(self.sbd_employee), {"professional_email": taken}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_pole_without_email_domain_gives_a_clear_error(self):
        Pole.objects.filter(name="SBD").update(email_domain="")
        self.login_hr_sbd()
        response = self.client.post(LIST_URL, self.payload("CD987654"), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("domaine email", response.json()["professional_email"][0])

    def test_hr_can_correct_the_email_of_an_existing_employee(self):
        """Les anciens collaborateurs gardent leur vraie boîte mail : le RH peut la corriger."""
        self.login_hr_sbd()
        response = self.client.patch(detail_url(self.sbd_employee), {"professional_email": "a.alami@sbd.ma"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["professional_email"], "a.alami@sbd.ma")
        self.sbd_employee.user.refresh_from_db()
        self.assertEqual(self.sbd_employee.user.email, "a.alami@sbd.ma")  # le compte suit le dossier

    # --- Ville choisie dans la liste (K3) -------------------------------------------------

    def test_city_comes_from_the_list(self):
        self.login_hr_sbd()
        response = self.client.post(LIST_URL, self.payload("CD987654", city="Casablanca"), format="json")  # un texte
        self.assertEqual(response.status_code, 400)
        self.assertIn("city", response.json())

    def test_collaborator_chooses_their_city_by_name(self):
        self.client.force_authenticate(self.sbd_employee.user)
        response = self.client.patch(ME_URL, {"city": "Fès"}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["city"], "Fès")

        response = self.client.patch(ME_URL, {"city": "Atlantis"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["city"], ["Choisissez une ville de la liste."])

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

    def test_fiche_shows_the_name_of_the_n_plus_1(self):
        """Le RH de SBD voit le nom du N+1 même s'il ne peut pas ouvrir son dossier (DG qui travaille à Riaya)."""
        self.login_hr_sbd()
        Pole.objects.filter(name="SBD").update(director=self.riaya_employee)  # pas de responsable : le DG
        data = self.client.get(detail_url(self.sbd_employee)).json()
        self.assertEqual(data["hierarchy"], [{"level": "N+1", "id": self.riaya_employee.pk, "label": str(self.riaya_employee)}])

    def test_no_delete(self):
        self.login_as(User.Role.HR_ADMIN)
        self.assertEqual(self.client.delete(detail_url(self.sbd_employee)).status_code, 405)

    # --- Mon dossier (/me/) ----------------------------------------------------------

    def test_collaborator_reads_their_own_fiche(self):
        self.client.force_authenticate(self.sbd_employee.user)
        response = self.client.get(ME_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["u_number"], self.sbd_employee.u_number)

    def test_my_fiche_shows_names_not_ids(self):
        """La page "Mon profil" affiche le texte reçu : pas de numéros à traduire."""
        Pole.objects.filter(name="SBD").update(director=self.riaya_employee)
        self.client.force_authenticate(self.sbd_employee.user)
        data = self.client.get(ME_URL).json()
        self.assertEqual(data["position"], "Commercial terrain")
        self.assertEqual(data["direction"], "Direction Commerciale")
        self.assertEqual(data["entity"], "Challenge")
        self.assertEqual(data["hierarchy"][0]["label"], str(self.riaya_employee))  # mon N+1, en texte

    def test_collaborator_only_changes_personal_fields(self):
        self.client.force_authenticate(self.sbd_employee.user)
        response = self.client.patch(ME_URL, {"phone": "0622222222", "last_name": "Pirate"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.sbd_employee.refresh_from_db()
        self.assertEqual(self.sbd_employee.phone, "+212622222222")  # champ personnel : changé (format +212)
        self.assertEqual(self.sbd_employee.last_name, "ALAMI")  # champ RH : ignoré (NOM stocké en majuscules)

    def test_old_fiche_without_marital_status_can_still_update_the_profile(self):
        """Un ancien dossier sans situation familiale : le collaborateur ne peut pas la choisir (champ RH),
        donc elle ne bloque pas la mise à jour de SON téléphone."""
        Employee.objects.filter(pk=self.sbd_employee.pk).update(marital_status="")
        self.client.force_authenticate(self.sbd_employee.user)
        response = self.client.patch(ME_URL, {"phone": "0622222222"}, format="json")
        self.assertEqual(response.status_code, 200, response.json())

    def test_hr_must_choose_the_marital_status(self):
        Employee.objects.filter(pk=self.sbd_employee.pk).update(marital_status="")
        self.login_hr_sbd()
        response = self.client.patch(detail_url(self.sbd_employee), {"phone": "0622222222"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("marital_status", response.json())

    def test_me_without_fiche_is_404(self):
        self.login_as(User.Role.COLLABORATOR)
        self.assertEqual(self.client.get(ME_URL).status_code, 404)
