"""La grille du préavis = la LOI par défaut (décret n° 2-04-469 du 29/12/2004, Code du travail art. 43) ; Admin RH
la change (contrat, convention collective) dans Réglages des arrivées et départs -> Notice period.
Les catégories "cadres et assimilés" : celles dont le nom contient "cadre" (ex. "Cadre") ; les autres = employés et
ouvriers. À VALIDER par les RH / un juriste."""
from django.db import migrations

RULES = [
    ("EXECUTIVE", 0, 1, "MONTHS"), ("EXECUTIVE", 1, 2, "MONTHS"), ("EXECUTIVE", 5, 3, "MONTHS"),
    ("OTHER", 0, 8, "DAYS"), ("OTHER", 1, 1, "MONTHS"), ("OTHER", 5, 2, "MONTHS"),
]


def defaults(apps, schema_editor):
    NoticeRule = apps.get_model("journeys", "NoticeRule")
    for group, min_years, amount, unit in RULES:
        NoticeRule.objects.get_or_create(group=group, min_years=min_years, defaults={"amount": amount, "unit": unit})
    JourneySettings = apps.get_model("journeys", "JourneySettings")
    Category = apps.get_model("employees", "Category")
    current, _ = JourneySettings.objects.get_or_create(pk=1)
    if not current.executive_categories.exists():
        current.executive_categories.set(Category.objects.filter(name__icontains="cadre"))


class Migration(migrations.Migration):
    dependencies = [("journeys", "0006_notice")]
    operations = [migrations.RunPython(defaults, migrations.RunPython.noop)]
