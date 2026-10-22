from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import Assignment, ContractType, Direction, Entity, Pole, TempAgency


class InitialValuesTests(TestCase):
    """The data migration filled the lists."""

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

    def test_inactive_value_still_exists(self):
        pole = Pole.objects.get(name="SBD")
        pole.is_active = False
        pole.save()
        self.assertTrue(Entity.objects.filter(pole=pole).exists())
