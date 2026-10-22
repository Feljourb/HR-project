import django.db.models.deletion
import django.db.models.functions.text
from django.db import migrations, models


class Migration(migrations.Migration):
    """A position now belongs to a department (unique inside it).
    No default needed for the new column: the Position table is still empty."""

    dependencies = [
        ("employees", "0002_initial_values"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="position",
            name="employees_position_unique_name",
        ),
        migrations.AddField(
            model_name="position",
            name="department",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="positions",
                to="employees.department",
                verbose_name="Service",
            ),
            preserve_default=False,
        ),
        migrations.AddConstraint(
            model_name="position",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("name"),
                models.F("department"),
                name="employees_position_unique_name_per_department",
                violation_error_message="Ce poste existe déjà dans ce service.",
            ),
        ),
    ]
