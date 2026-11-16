"""Remarque des RH (2026-11-16) : le justificatif n'est PAS obligatoire (comme leur outil actuel). La case
"Justificatif obligatoire" reste dans la page Reference lists (Admin RH peut la recocher pour une catégorie),
mais elle est décochée pour toutes les catégories ; une nouvelle catégorie aussi (défaut du modèle : False)."""
from django.db import migrations, models


def receipts_optional(apps, schema_editor):
    apps.get_model("expenses", "ExpenseCategory").objects.update(receipt_required=False)


def receipts_required(apps, schema_editor):
    apps.get_model("expenses", "ExpenseCategory").objects.update(receipt_required=True)


class Migration(migrations.Migration):

    dependencies = [
        ('expenses', '0009_expense_circuit_hr_validates'),
    ]

    operations = [
        migrations.AlterField(
            model_name='expensecategory',
            name='receipt_required',
            field=models.BooleanField(default=False, verbose_name='Justificatif obligatoire'),
        ),
        migrations.RunPython(receipts_optional, receipts_required),
    ]
