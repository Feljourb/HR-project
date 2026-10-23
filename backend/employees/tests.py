import datetime
import io
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from openpyxl import load_workbook

from .models import (
    Assignment, Bank, Category, ContractType, Department, Direction, Employee, Entity, Pole, Position, Region,
    TempAgency,
)


class InitialValuesTests(TestCase):
    """The data migrations filled the lists."""

    def test_poles_and_their_entities(self):
        self.assertEqual(
            sorted(Entity.objects.filter(pole__name="SBD").values_list("name", flat=True)),
            ["Challenge", "Silent Believers Distribution"],
        )
        self.assertEqual(
            sorted(Entity.objects.filter(pole__name="Riaya").values_list("name", flat=True)),
            ["Eureka", "Norsudex", "Riaya"],
        )

    def test_simple_lists(self):
        self.assertEqual(Assignment.objects.count(), 5)
        self.assertEqual(ContractType.objects.count(), 4)
        self.assertEqual(TempAgency.objects.count(), 3)
        self.assertEqual(Region.objects.count(), 12)
        self.assertTrue(Bank.objects.filter(name="Umnia Bank").exists())

    def test_only_three_categories(self):
        self.assertEqual(
            sorted(Category.objects.values_list("name", flat=True)),
            ["Cadre", "Employé", "Ouvrier"],
        )

    def test_organisation_depends_on_the_pole(self):
        challenge = Entity.objects.get(name="Challenge")  # SBD: distribution
        eureka = Entity.objects.get(name="Eureka")  # Riaya: industry
        for entity in (challenge, eureka):
            self.assertTrue(entity.directions.filter(name="Direction des Ressources Humaines").exists())
        self.assertTrue(challenge.directions.filter(name="Direction Commerciale").exists())
        self.assertFalse(eureka.directions.filter(name="Direction Commerciale").exists())
        self.assertTrue(Position.objects.filter(
            name="Opérateur de production", department__direction__entity=eureka).exists())


class UniqueNameTests(TestCase):
    def test_same_name_with_other_case_is_refused(self):
        with self.assertRaises(ValidationError):
            Assignment(name="field").full_clean()  # "Field" already exists

    def test_same_direction_name_allowed_in_two_entities(self):
        sbd = Entity.objects.get(name="Silent Believers Distribution")
        riaya = Entity.objects.get(name="Riaya")
        Direction.objects.create(name="IT", entity=sbd)
        Direction(name="it", entity=riaya).full_clean()  # OK: another entity
        with self.assertRaises(ValidationError):
            Direction(name="it", entity=sbd).full_clean()  # same entity: refused

    def test_same_position_name_allowed_in_two_departments(self):
        sales = Department.objects.get(name="Ventes", direction__entity__name="Challenge")
        warehouse = Department.objects.get(name="Entreposage", direction__entity__name="Challenge")
        Position(name="chef des ventes", department=warehouse).full_clean()  # OK: another service
        with self.assertRaises(ValidationError):
            Position(name="chef des ventes", department=sales).full_clean()  # same service: refused

    def test_inactive_value_still_exists(self):
        pole = Pole.objects.get(name="SBD")
        pole.is_active = False
        pole.save()
        self.assertTrue(Entity.objects.filter(pole=pole).exists())


class ExportListsTests(TestCase):
    def test_one_sheet_per_list(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "lists.xlsx"
            call_command("export_lists", output=str(path), stdout=io.StringIO())
            workbook = load_workbook(path)

        self.assertEqual(len(workbook.sheetnames), 14)
        positions = workbook["Postes"]
        self.assertEqual([cell.value for cell in positions[1]], ["Entité", "Direction", "Service", "Nom", "Actif"])
        self.assertEqual(positions.max_row - 1, Position.objects.count())


class EmployeeTests(TestCase):
    def setUp(self):
        # "Ventes" of Challenge (pôle SBD), from the data migration.
        self.sales = Department.objects.get(name="Ventes", direction__entity__name="Challenge")
        self.salesman = self.sales.positions.get(name="Commercial terrain")

    def make_employee(self, username, cin, save=True, **fields):
        """A valid employee; `fields` replaces any value."""
        values = {
            "user": get_user_model().objects.create_user(username),
            "title": Employee.Title.MR, "last_name": "Alami", "first_name": "Ahmed",
            "birth_date": datetime.date(1990, 5, 1), "cin": cin, "city": "Casablanca",
            "address": "12 rue Atlas", "phone": "0600000000", "professional_email": f"{username}@sbd.ma",
            "marital_status": Employee.MaritalStatus.SINGLE,
            "department": self.sales, "position": self.salesman,
            "assignment": Assignment.objects.get(name="Field"), "category": Category.objects.get(name="Employé"),
            "contract_type": ContractType.objects.get(name="CDI"), "region": Region.objects.get(name="Casablanca-Settat"),
            "work_location": "Casablanca", "hire_date": datetime.date(2026, 1, 5),
            **fields,
        }
        employee = Employee(**values)
        employee.full_clean()
        if save:
            employee.save()
        return employee

    def test_u_number_is_generated_in_order_and_never_changes(self):
        first = self.make_employee("a.alami", "AB111111")
        second = self.make_employee("b.bennani", "AB222222")

        self.assertEqual(first.u_number, f"U{first.pk:06d}")  # e.g. U000001
        self.assertEqual(int(second.u_number[1:]), int(first.u_number[1:]) + 1)

        first.last_name = "El Alami"
        first.save()
        first.refresh_from_db()
        self.assertEqual(first.u_number, f"U{first.pk:06d}")

    def test_cin_is_unique_whatever_the_case(self):
        self.make_employee("a.alami", "AB111111")
        with self.assertRaises(ValidationError) as error:
            self.make_employee("b.bennani", "ab111111")
        self.assertIn("cin", error.exception.message_dict)

    def test_position_of_another_department_is_refused(self):
        warehouse_job = Position.objects.get(name="Magasinier", department__direction__entity__name="Challenge")
        with self.assertRaises(ValidationError) as error:
            self.make_employee("a.alami", "AB111111", position=warehouse_job)
        self.assertIn("position", error.exception.message_dict)

    def test_temp_agency_only_for_interim(self):
        interim = ContractType.objects.get(name="Intérimaire")
        agency = TempAgency.objects.get(name="PRESTATIS")

        with self.assertRaises(ValidationError):  # interim without agency
            self.make_employee("a.alami", "AB111111", contract_type=interim)
        with self.assertRaises(ValidationError):  # CDI with an agency
            self.make_employee("b.bennani", "AB222222", temp_agency=agency)
        self.make_employee("c.chraibi", "AB333333", contract_type=interim, temp_agency=agency)  # OK

    def test_direction_entity_and_pole_come_from_the_department(self):
        employee = self.make_employee("a.alami", "AB111111")
        self.assertEqual(employee.direction.name, "Direction Commerciale")
        self.assertEqual(employee.entity.name, "Challenge")
        self.assertEqual(employee.pole.name, "SBD")

    def test_n_plus_2_and_n_plus_3(self):
        director = self.make_employee("d.director", "AB000003")
        chief = self.make_employee("c.chief", "AB000002", manager=director)
        boss = self.make_employee("b.boss", "AB000001", manager=chief)
        employee = self.make_employee("a.alami", "AB111111", manager=boss)

        self.assertEqual(employee.manager, boss)
        self.assertEqual(employee.n_plus_2, chief)
        self.assertEqual(employee.n_plus_3, director)
        self.assertIsNone(director.n_plus_2)

    def test_manager_loop_is_refused(self):
        boss = self.make_employee("b.boss", "AB000001")
        employee = self.make_employee("a.alami", "AB111111", manager=boss)
        boss.manager = employee  # A -> B -> A
        with self.assertRaises(ValidationError) as error:
            boss.full_clean()
        self.assertIn("manager", error.exception.message_dict)
