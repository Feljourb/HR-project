from django.db import migrations

# HR keeps only Cadre, Employé and Ouvrier. No employee uses the others yet,
# so they are deleted (once a value is used, it is deactivated instead).
REMOVED_CATEGORIES = ["Cadre supérieur", "Agent de maîtrise"]


def remove(apps, schema_editor):
    Category = apps.get_model("employees", "Category")
    for name in REMOVED_CATEGORIES:
        Category.objects.filter(name__iexact=name).delete()


def add_back(apps, schema_editor):
    Category = apps.get_model("employees", "Category")
    for name in REMOVED_CATEGORIES:
        Category.objects.get_or_create(name__iexact=name, defaults={"name": name})


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0004_standard_referential"),
    ]

    operations = [
        migrations.RunPython(remove, add_back),
    ]
