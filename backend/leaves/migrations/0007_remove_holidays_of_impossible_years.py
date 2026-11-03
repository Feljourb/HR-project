"""Efface les jours fériés créés PAR ERREUR pour des années impossibles (an 2, 20, 202...).

Bug du 2026-11-03 : pendant qu'on tapait "2026" dans une date de congé, l'aperçu recevait 0002, 0020, 0202...
et l'application créait les jours fériés de ces années. Ce ne sont pas des valeurs de la liste (personne ne
les a choisies) : on les efface. Seulement ceux créés par l'application (avec une clé) : jamais un jour
ajouté à la main par Admin RH.
"""
from django.db import migrations


def remove_impossible_years(apps, schema_editor):
    PublicHoliday = apps.get_model("leaves", "PublicHoliday")
    PublicHoliday.objects.exclude(key="").filter(date__year__lt=2000).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("leaves", "0006_six_months_before_first_leave"),
    ]

    operations = [
        migrations.RunPython(remove_impossible_years, migrations.RunPython.noop),
    ]
