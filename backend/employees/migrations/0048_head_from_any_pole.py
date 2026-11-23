# B7, 2nd decision of the user (2026-11-23): "a SBD collaborator can have an N+1 from Riaya" = the head of a service /
# direction can be ANYONE (SBD or Riaya). The "employer" field and the entity "Les deux pôles" of migration 0047 are
# not needed any more. Step 1 (here): remove the entity "Les deux pôles" and its demo organisation.
# Step 2 (0049): remove the field and make the pôle of an entity required again (Postgres: not in the same transaction).

from django.db import migrations


def remove_common_entity(apps, schema_editor):
    """The entity "Les deux pôles" (no pôle) and the demo organisation put in it (Informatique > Infrastructure >
    Technicien). Nobody may work there: if someone does, stop (HR must move them first)."""
    Entity = apps.get_model("employees", "Entity")
    Employee = apps.get_model("employees", "Employee")
    for entity in Entity.objects.filter(pole__isnull=True):
        if Employee.objects.filter(department__direction__entity=entity).exists():
            raise RuntimeError(f"Des collaborateurs travaillent dans « {entity.name} » : changez d'abord leur service.")
        for direction in entity.directions.all():
            for department in direction.departments.all():
                department.positions.all().delete()
            direction.departments.all().delete()
        entity.directions.all().delete()
        entity.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('employees', '0047_employer_and_common_entity'),
    ]

    operations = [
        migrations.RunPython(remove_common_entity, migrations.RunPython.noop),
    ]
