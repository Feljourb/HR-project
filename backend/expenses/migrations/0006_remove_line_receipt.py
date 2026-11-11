"""2026-11-11 : les justificatifs sont maintenant dans ExpenseReceipt (recopiés par 0005) : les anciennes
colonnes de la dépense (un seul fichier) ne servent plus."""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0005_expense_receipts"),
    ]

    operations = [
        migrations.RemoveField(model_name="expenseline", name="receipt"),
        migrations.RemoveField(model_name="expenseline", name="receipt_name"),
    ]
