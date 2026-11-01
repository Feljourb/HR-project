"""Tests de la hiérarchie automatique (K4) : N+1, N+2... lus dans l'organigramme.

L'organigramme du test (pôle SBD, entité Challenge, Direction Commerciale) :
    DG (dans une autre direction)
     └─ Nizar   responsable de la Direction Commerciale (service "Direction")
         ├─ Omar    responsable du service "Direction"
         └─ Youssef responsable du service "Ventes"
              └─ Sara (Ventes)
"""
from django.core.exceptions import ValidationError
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from workflows import engine

from .models import Department, Direction, Employee, EmployeeHistory, Pole
from .tests import EmployeeTestCase


def fresh(employee):
    """Le dossier relu en base (les responsables viennent d'être changés)."""
    return Employee.objects.get(pk=employee.pk)


class HierarchyTestCase(EmployeeTestCase):
    def setUp(self):
        super().setUp()
        self.commercial = self.sales.direction
        self.office = self.commercial.departments.get(name="Direction")
        director_job = self.office.positions.get(name="Directeur Commercial")
        # Le DG travaille dans une autre direction de la même entité.
        elsewhere = Department.objects.filter(direction__entity=self.commercial.entity).exclude(direction=self.commercial).first()

        self.dg = self.make_employee("d.dg", "AB000001", first_name="Dg", department=elsewhere, position=elsewhere.positions.first())
        self.nizar = self.make_employee("n.nizar", "AB000002", first_name="Nizar", department=self.office, position=director_job)
        self.omar = self.make_employee("o.omar", "AB000003", first_name="Omar", department=self.office, position=director_job)
        self.youssef = self.make_employee("y.youssef", "AB000004", first_name="Youssef")  # Ventes
        self.sara = self.make_employee("s.sara", "AB000005", first_name="Sara")           # Ventes

        Pole.objects.filter(name="SBD").update(director=self.dg)
        Direction.objects.filter(pk=self.commercial.pk).update(head=self.nizar)
        Department.objects.filter(pk=self.office.pk).update(head=self.omar)
        Department.objects.filter(pk=self.sales.pk).update(head=self.youssef)


class OrgChartTests(HierarchyTestCase):
    def test_member_reports_to_the_head_of_their_service_then_up_to_the_dg(self):
        sara = fresh(self.sara)
        self.assertEqual(sara.hierarchy(), [self.youssef, self.nizar, self.dg])
        self.assertEqual((sara.n_plus_1, sara.n_plus_2, sara.n_plus_3), (self.youssef, self.nizar, self.dg))

    def test_service_without_head_goes_to_the_direction_head(self):
        Department.objects.filter(pk=self.sales.pk).update(head=None)
        self.assertEqual(fresh(self.sara).n_plus_1, self.nizar)  # "ghir N+1" puis le DG
        self.assertEqual(fresh(self.sara).hierarchy(), [self.nizar, self.dg])

    def test_heads_report_to_the_level_above(self):
        self.assertEqual(fresh(self.youssef).n_plus_1, self.nizar)  # chef d'équipe -> directeur
        self.assertEqual(fresh(self.omar).n_plus_1, self.nizar)
        # Le directeur est dans le service "Direction" dirigé par Omar, mais il ne dépend pas de lui.
        self.assertEqual(fresh(self.nizar).n_plus_1, self.dg)

    def test_dg_is_at_the_top(self):
        self.assertEqual(fresh(self.dg).hierarchy(), [])

    def test_a_new_head_is_followed_by_the_whole_team_at_once(self):
        amina = self.make_employee("a.amina", "AB000006", first_name="Amina")  # Ventes
        Department.objects.filter(pk=self.sales.pk).update(head=amina)
        self.assertEqual(fresh(self.sara).n_plus_1, amina)  # aucune fiche à modifier

    def test_a_new_fiche_in_a_direction_without_head(self):
        """Pas encore enregistré (pas d'id) + direction sans responsable : "None == None" ne doit pas
        faire croire qu'il est le directeur. Son N+1 est bien le responsable de son service."""
        Direction.objects.filter(pk=self.commercial.pk).update(head=None)
        draft = Employee(department=Department.objects.get(pk=self.sales.pk))
        self.assertEqual(draft.hierarchy(), [self.youssef, self.dg])

    def test_a_head_who_left_is_skipped(self):
        Employee.objects.filter(pk=self.youssef.pk).update(status=Employee.Status.LEFT)
        self.assertEqual(fresh(self.sara).n_plus_1, self.nizar)


class HeadRulesTests(HierarchyTestCase):
    def errors_of(self, item):
        with self.assertRaises(ValidationError) as error:
            item.full_clean()
        return error.exception.message_dict

    def test_head_works_in_their_service_or_direction(self):
        sales = Department.objects.get(pk=self.sales.pk)
        sales.head = self.nizar  # il est dans le service "Direction", pas dans "Ventes"
        self.assertEqual(self.errors_of(sales)["head"], ["Le responsable doit faire partie de ce service."])

        commercial = Direction.objects.get(pk=self.commercial.pk)
        commercial.head = self.dg  # il travaille dans une autre direction
        self.assertEqual(self.errors_of(commercial)["head"], ["Le responsable doit travailler dans cette direction."])
        commercial.head = self.sara  # Ventes est dans cette direction : OK
        commercial.full_clean()

    def test_an_employee_who_left_cannot_be_head(self):
        Employee.objects.filter(pk=self.sara.pk).update(status=Employee.Status.LEFT)
        sales = Department.objects.get(pk=self.sales.pk)
        sales.head = fresh(self.sara)
        self.assertIn("head", self.errors_of(sales))

    def test_a_head_cannot_leave_their_team(self):
        youssef = fresh(self.youssef)
        youssef.department = self.office
        youssef.position = self.office.positions.first()
        self.assertIn("Ventes", self.errors_of(youssef)["department"][0])


class HierarchyApiAndEngineTests(HierarchyTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user("admin.rh", role=User.Role.HR_ADMIN, must_change_password=False))

    def test_admin_rh_chooses_the_head_on_the_lists_page(self):
        url = reverse("employees:departments-detail", args=[self.sales.pk])
        amina = self.make_employee("a.amina", "AB000006", first_name="Amina")  # Ventes
        response = self.client.patch(url, {"head": amina.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["head_label"], str(amina))  # le nom, pour la page Listes

        response = self.client.patch(url, {"head": self.nizar.pk}, format="json")  # pas dans Ventes
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["head"], ["Le responsable doit faire partie de ce service."])

        self.assertEqual(self.client.patch(url, {"head": None}, format="json").status_code, 200)  # plus de responsable

    def test_a_change_of_head_goes_to_the_history(self):
        """Youssef -> Amina : une ligne dans la fiche des deux, visible dans l'Audit log."""
        amina = self.make_employee("a.amina", "AB000006", first_name="Amina")  # Ventes
        url = reverse("employees:departments-detail", args=[self.sales.pk])
        self.client.patch(url, {"head": amina.pk}, format="json")
        expected = [{"field": "Responsable du service « Ventes »", "old": str(self.youssef), "new": str(amina)}]
        for person in (amina, self.youssef):
            entry = person.history.get(action=EmployeeHistory.Action.HEAD)
            self.assertEqual((entry.actor_name, entry.changes), ("admin.rh", expected))

        audit = self.client.get(reverse("employees:employee-audit-log"), {"action": "HEAD"}).json()["results"]
        self.assertEqual(len(audit), 2)

        # Renommer le service (sans toucher au responsable) : rien de plus dans l'historique.
        self.client.patch(url, {"name": "Ventes terrain"}, format="json")
        self.assertEqual(EmployeeHistory.objects.filter(action=EmployeeHistory.Action.HEAD).count(), 2)

    def test_only_admin_rh_chooses_a_head(self):
        hr = self.make_employee("h.hr", "AB000007", first_name="Rh")
        User.objects.filter(pk=hr.user_id).update(role=User.Role.HR, must_change_password=False)
        self.client.force_authenticate(User.objects.get(pk=hr.user_id))
        url = reverse("employees:departments-detail", args=[self.sales.pk])
        self.assertEqual(self.client.patch(url, {"head": self.sara.pk}, format="json").status_code, 403)

    def test_search_people_of_one_service(self):
        """Le choix du responsable ne propose que les gens du service (ou de la direction)."""
        rows = self.client.get(reverse("employees:employee-list"), {"department": self.sales.pk}).json()["results"]
        self.assertEqual({row["id"] for row in rows}, {self.youssef.pk, self.sara.pk})
        rows = self.client.get(reverse("employees:employee-list"), {"direction": self.commercial.pk}).json()["results"]
        self.assertEqual({row["id"] for row in rows}, {self.youssef.pk, self.sara.pk, self.nizar.pk, self.omar.pk})

    def preview(self, **params):
        """Les noms de la chaîne calculée PENDANT la saisie (avant d'enregistrer)."""
        response = self.client.get(reverse("employees:employee-hierarchy-preview"), params)
        self.assertEqual(response.status_code, 200)
        return [level["id"] for level in response.json()]

    def test_the_form_shows_the_chain_as_soon_as_the_service_is_chosen(self):
        self.assertEqual(self.preview(), [])  # pas encore de service
        self.assertEqual(self.preview(department=self.sales.pk), [self.youssef.pk, self.nizar.pk, self.dg.pk])

    def test_nobody_in_charge_gives_the_dg_and_the_dg_has_nobody(self):
        Department.objects.filter(pk=self.sales.pk).update(head=None)
        Direction.objects.filter(pk=self.commercial.pk).update(head=None)
        self.assertEqual(self.preview(department=self.sales.pk), [self.dg.pk])  # N+1 = DG
        # Modification de la fiche du DG lui-même : personne au-dessus.
        self.assertEqual(self.preview(department=self.dg.department_id, employee=self.dg.pk), [])
        # Modification de la fiche du directeur : il ne dépend pas d'Omar (son service), mais du DG.
        Direction.objects.filter(pk=self.commercial.pk).update(head=self.nizar)
        self.assertEqual(self.preview(department=self.office.pk, employee=self.nizar.pk), [self.dg.pk])

    def test_the_fiche_shows_the_whole_chain(self):
        data = self.client.get(reverse("employees:employee-detail", args=[self.sara.pk])).json()
        self.assertEqual(data["hierarchy"], [
            {"level": "N+1", "id": self.youssef.pk, "label": str(self.youssef)},
            {"level": "N+2", "id": self.nizar.pk, "label": str(self.nizar)},
            {"level": "N+3", "id": self.dg.pk, "label": str(self.dg)},
        ])

    def test_a_leave_request_goes_to_the_head_of_the_service(self):
        """Personne n'a rempli de manager dans la fiche : le moteur lit l'organigramme."""
        request = engine.submit("LEAVE", fresh(self.sara), "Congé du 2 au 6 décembre")
        self.assertEqual(request.steps.get(order=1).assignee, self.youssef)
