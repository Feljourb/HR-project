"""2026-11-11 : PLUSIEURS justificatifs par dépense (ex. la facture de l'hôtel + le ticket de la carte bancaire).
La nouvelle table ExpenseReceipt (une ligne = un fichier), puis chaque justificatif déjà envoyé y est recopié
(le même fichier dans media/receipts/ : rien n'est déplacé ni perdu). Les anciennes colonnes partent en 0006."""
import django.core.validators
import django.db.models.deletion
from django.db import migrations, models

import expenses.models


def copy_receipts(apps, schema_editor):
    ExpenseLine = apps.get_model("expenses", "ExpenseLine")
    ExpenseReceipt = apps.get_model("expenses", "ExpenseReceipt")
    for line in ExpenseLine.objects.exclude(receipt=""):
        ExpenseReceipt.objects.create(line=line, file=line.receipt.name, name=line.receipt_name)


def copy_back(apps, schema_editor):
    # Retour en arrière : le premier justificatif de chaque dépense reprend sa place.
    ExpenseReceipt = apps.get_model("expenses", "ExpenseReceipt")
    for receipt in ExpenseReceipt.objects.order_by("-id"):
        line = receipt.line
        line.receipt, line.receipt_name = receipt.file.name, receipt.name
        line.save(update_fields=["receipt", "receipt_name"])


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0004_expense_circuit_hr_informed"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExpenseReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to=expenses.models.receipt_path, validators=[
                    django.core.validators.FileExtensionValidator(["pdf", "jpg", "jpeg", "png"]), expenses.models.receipt_size,
                ], verbose_name="Fichier")),
                ("name", models.CharField(blank=True, max_length=200, verbose_name="Nom du fichier envoyé")),
                ("line", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="receipts",
                                           to="expenses.expenseline", verbose_name="Dépense")),
            ],
            options={"verbose_name": "Justificatif", "ordering": ["id"]},
        ),
        migrations.RunPython(copy_receipts, copy_back),
    ]
