"""Les devises de départ (comme l'outil NOOR des RH, 2026-11-16) : MAD (toujours 1), EUR et USD.
Les taux sont ceux du 16/11/2026 ; ensuite l'application les met à jour toute seule chaque matin (expenses/rates.py)."""
from decimal import Decimal

from django.db import migrations

CURRENCIES = [("MAD", Decimal("1")), ("EUR", Decimal("10.9553")), ("USD", Decimal("9.9225"))]


def create(apps, schema_editor):
    Currency = apps.get_model("expenses", "Currency")
    for code, rate in CURRENCIES:
        Currency.objects.get_or_create(name=code, defaults={"rate_to_mad": rate, "automatic": code != "MAD"})


def remove(apps, schema_editor):
    apps.get_model("expenses", "Currency").objects.filter(name__in=[code for code, _ in CURRENCIES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('expenses', '0011_currencies'),
    ]

    operations = [
        migrations.RunPython(create, remove),
    ]
