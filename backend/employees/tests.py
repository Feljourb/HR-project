import io
import tempfile
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from openpyxl import load_workbook

from .models import (
    Assignment, Bank, ContractType, Department, Direction, Entity, Pole, Position, Region, TempAgency,
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
