"""Tests de l'historique (step F) et du changement de rôle depuis la fiche."""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from . import history, services
from .models import Bank, Department, EmployeeHistory
from .tests import EmployeeTestCase

User = get_user_model()
Action = EmployeeHistory.Action


class HistoryTestCase(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.karim = self.ready("AB000001", first_name="Karim")  # collaborateur de SBD

    def ready(self, cin, role=None, **fields):
        """Un dossier enregistré avec son compte (mot de passe déjà changé)."""
        employee = services.create_with_account(self.fiche(cin, **fields), role=role)
        employee.user.must_change_password = False
        employee.user.save()
        return employee

    def login(self, employee):
        self.client.force_authenticate(employee.user)
        return employee

    def url(self, employee, suffix=""):
        name = "employees:employee-history" if suffix == "history" else "employees:employee-detail"
        return reverse(name, args=[employee.pk])

    def last(self, employee):
        return employee.history.first()  # le plus récent


class HistoryRecordsTests(HistoryTestCase):
    def test_creation_through_the_api(self):
        hr = self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        payload = {
            "title": "MME", "last_name": "Bennani", "first_name": "Sara", "birth_date": "1995-03-10",
            "cin": "CD987654", "city": "Casablanca", "address": "1 rue", "phone": "0600000000",
            "professional_email": "sara@sbd.ma", "department": self.sales.pk, "position": self.salesman.pk,
            "assignment": self.karim.assignment.pk, "category": self.karim.category.pk,
            "contract_type": self.karim.contract_type.pk, "region": self.karim.region.pk,
            "work_location": "Casablanca", "hire_date": "2026-01-05",
        }
        response = self.client.post(reverse("employees:employee-list"), payload, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        entry = EmployeeHistory.objects.get(employee_id=response.json()["id"])
        self.assertEqual((entry.action, entry.actor, entry.actor_name), (Action.CREATED, hr.user, hr.user.username))

    def test_changed_fields_with_old_and_new_values(self):
        hr = self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        self.client.patch(self.url(self.karim), {"phone": "0611111111", "status": "TRIAL"}, format="json")

        entry = self.last(self.karim)
        self.assertEqual(entry.action, Action.UPDATED)
        self.assertEqual(entry.actor, hr.user)
        self.assertIn({"field": "Téléphone", "old": "0600000000", "new": "0611111111"}, entry.changes)
        self.assertIn({"field": "Statut", "old": "Actif", "new": "Période d'essai"}, entry.changes)  # libellés lisibles

    def test_nothing_changed_writes_nothing(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        count = self.karim.history.count()
        self.client.patch(self.url(self.karim), {"phone": self.karim.phone}, format="json")
        self.assertEqual(self.karim.history.count(), count)

    def test_secret_numbers_are_never_written(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        bank = Bank.objects.get(name="CIH Bank")
        self.client.patch(self.url(self.karim), {"rib": "011780000001234567890123", "bank": bank.pk}, format="json")

        changes = self.last(self.karim).changes
        self.assertIn({"field": "RIB", "hidden": True}, changes)
        self.assertNotIn("011780000001234567890123", str(changes))

    def test_children_changes(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        self.client.patch(self.url(self.karim), {"children": [{"first_name": "Yasmine", "birth_date": "2018-04-02"}]}, format="json")
        self.assertIn({"field": "Enfants", "old": "", "new": "Yasmine (02/04/2018)"}, self.last(self.karim).changes)

    def test_my_profile_changes_are_recorded_too(self):
        self.login(self.karim)
        self.client.patch(reverse("employees:employee-me"), {"phone": "0622222222"}, format="json")
        entry = self.last(self.karim)
        self.assertEqual((entry.action, entry.actor), (Action.UPDATED, self.karim.user))

    def test_password_reset(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        self.client.post(reverse("employees:employee-reset-password", args=[self.karim.pk]))
        entry = self.last(self.karim)
        self.assertEqual(entry.action, Action.PASSWORD_RESET)
        self.assertEqual(entry.changes, [])  # jamais le mot de passe


class HistoryAccessTests(HistoryTestCase):
    def test_hr_reads_the_history_newest_first(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        self.client.patch(self.url(self.karim), {"phone": "0611111111"}, format="json")
        response = self.client.get(self.url(self.karim, "history"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["action_label"], "Modification")

    def test_other_pole_and_collaborators_cannot_read_it(self):
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        riaya_hr = self.ready("HR000002", role=User.Role.HR, first_name="Rh",
                              department=production, position=production.positions.first())
        self.login(riaya_hr)
        self.assertEqual(self.client.get(self.url(self.karim, "history")).status_code, 404)
        self.login(self.karim)
        self.assertEqual(self.client.get(self.url(self.karim, "history")).status_code, 403)

    def test_it_reads_it_in_admin_but_cannot_change_it(self):
        it = User.objects.create_superuser("it.admin", password="Strong-Pass-2026!")
        self.client.force_login(it)
        entry = self.karim.history.create(actor_name="x", action=Action.UPDATED)
        self.assertEqual(self.client.get(reverse("admin:employees_employeehistory_changelist")).status_code, 200)
        self.client.post(reverse("admin:employees_employeehistory_delete", args=[entry.pk]), {"post": "yes"})
        self.assertTrue(EmployeeHistory.objects.filter(pk=entry.pk).exists())


class AuditLogTests(HistoryTestCase):
    """La page "Audit log" : le journal de tous les dossiers."""

    URL = reverse("employees:employee-audit-log")

    def setUp(self):
        super().setUp()
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        self.salma = self.ready("AB000002", first_name="Salma", department=production,
                                position=production.positions.first())  # pôle Riaya
        # Une ligne de journal pour chacun (ready() passe par le service, qui n'écrit pas d'historique).
        for employee in (self.karim, self.salma):
            history.record(employee, None, Action.CREATED)

    def names(self, response):
        return {row["employee_label"].split(" - ")[1] for row in response.json()["results"]}

    def test_hr_admin_sees_both_poles_and_hr_only_theirs(self):
        self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        self.assertTrue({"ALAMI Karim", "ALAMI Salma"} <= self.names(self.client.get(self.URL)))

        self.login(self.ready("HR000002", role=User.Role.HR, first_name="Rh"))  # RH de SBD
        names = self.names(self.client.get(self.URL))
        self.assertIn("ALAMI Karim", names)
        self.assertNotIn("ALAMI Salma", names)

    def test_collaborators_are_refused(self):
        self.login(self.karim)
        self.assertEqual(self.client.get(self.URL).status_code, 403)

    def test_filters(self):
        hr = self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        self.client.patch(self.url(self.karim), {"phone": "0611111111"}, format="json")

        rows = self.client.get(self.URL, {"search": "karim", "action": "UPDATED", "actor": hr.user.username}).json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["employee"], self.karim.pk)
        today = rows[0]["created_at"][:10]
        self.assertEqual(self.client.get(self.URL, {"date_from": today, "date_to": today}).status_code, 200)
        self.assertEqual(self.client.get(self.URL, {"date_from": "2999-01-01"}).json()["count"], 0)

    def test_wrong_filters_are_a_clear_400(self):
        self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        self.assertIn("action", self.client.get(self.URL, {"action": "DROP"}).json())
        self.assertIn("date_to", self.client.get(self.URL, {"date_to": "2026-13-45"}).json())


class RoleChangeTests(HistoryTestCase):
    def patch_role(self, employee, role):
        return self.client.patch(self.url(employee), {"role": role}, format="json")

    def test_hr_promotes_a_collaborator_to_manager(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        self.assertEqual(self.patch_role(self.karim, "MANAGER").status_code, 200)
        self.karim.user.refresh_from_db()
        self.assertEqual(self.karim.user.role, User.Role.MANAGER)
        self.assertEqual(self.last(self.karim).changes,
                         [{"field": "Rôle du compte", "old": "Collaborateur", "new": "Manager"}])

    def test_hr_cannot_give_or_remove_an_hr_role(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        self.assertEqual(self.patch_role(self.karim, "HR").status_code, 400)
        other_hr = self.ready("HR000002", role=User.Role.HR, first_name="Rh2")
        self.assertEqual(self.patch_role(other_hr, "COLLABORATOR").status_code, 400)

    def test_nobody_changes_their_own_role(self):
        admin = self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        self.assertEqual(self.patch_role(admin, "COLLABORATOR").status_code, 400)

    def test_hr_admin_gives_an_hr_role(self):
        self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        self.assertEqual(self.patch_role(self.karim, "HR").status_code, 200)
        self.karim.user.refresh_from_db()
        self.assertEqual(self.karim.user.role, User.Role.HR)

    def test_only_it_gives_or_removes_hr_admin(self):
        """Chacun donne des rôles EN DESSOUS du sien : un Admin RH ne crée pas d'autre Admin RH."""
        self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        self.assertEqual(self.patch_role(self.karim, "HR_ADMIN").status_code, 400)
        other_admin = self.ready("HR000002", role=User.Role.HR_ADMIN, first_name="Admin2")
        self.assertEqual(self.patch_role(other_admin, "HR").status_code, 400)
        payload_role = self.client.post(reverse("employees:employee-list"), {"role": "HR_ADMIN"}, format="json").json()
        self.assertIn("role", payload_role)  # création : refusé aussi

        it = User.objects.create_superuser("it.admin", password="Strong-Pass-2026!")
        self.client.force_authenticate(it)
        self.assertEqual(self.patch_role(self.karim, "HR_ADMIN").status_code, 200)

    def test_hr_admin_cannot_reset_another_hr_admin(self):
        self.login(self.ready("HR000001", role=User.Role.HR_ADMIN, first_name="Admin"))
        other_admin = self.ready("HR000002", role=User.Role.HR_ADMIN, first_name="Admin2")
        self.assertEqual(self.client.post(reverse("employees:employee-reset-password", args=[other_admin.pk])).status_code, 403)

    def test_the_form_knows_which_roles_it_can_give(self):
        self.login(self.ready("HR000001", role=User.Role.HR, first_name="Rh"))
        data = self.client.get(self.url(self.karim)).json()
        self.assertEqual(data["account_role"], "COLLABORATOR")
        self.assertEqual(sorted(data["assignable_roles"]), ["COLLABORATOR", "MANAGER"])

        self.login(self.ready("HR000002", role=User.Role.HR_ADMIN, first_name="Admin"))
        data = self.client.get(self.url(self.karim)).json()
        self.assertEqual(sorted(data["assignable_roles"]), ["COLLABORATOR", "HR", "MANAGER"])  # pas HR_ADMIN
