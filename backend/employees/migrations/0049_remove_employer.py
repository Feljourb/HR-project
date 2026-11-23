# B7, 2nd decision of the user (2026-11-23), step 2: the pôle of an employee comes again from his service.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('employees', '0048_head_from_any_pole'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='employee',
            name='employer',
        ),
        migrations.AlterField(
            model_name='entity',
            name='pole',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='entities', to='employees.pole', verbose_name='Pôle'),
        ),
    ]
