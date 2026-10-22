from django.db import migrations

ENTITIES = {
    "SBD": ["Silent Believers Distribution", "Challenge"],
    "Riaya": ["Riaya", "Eureka", "Norsudex"],
}
SIMPLE_LISTS = {
    "Assignment": ["Field", "HQ", "Hub", "Factory", "Agence"],
    "ContractType": ["CDI", "CDD", "Stagiaire", "Intérimaire"],
    "TempAgency": ["KRESTATIS", "PRESTATIS", "DRESTATIS"],
}


def add_values(apps, schema_editor):
    Pole = apps.get_model("employees", "Pole")
    Entity = apps.get_model("employees", "Entity")
    for pole_name, entity_names in ENTITIES.items():
        pole, _ = Pole.objects.get_or_create(name=pole_name)
        for entity_name in entity_names:
            Entity.objects.get_or_create(name=entity_name, defaults={"pole": pole})

    for model_name, names in SIMPLE_LISTS.items():
        model = apps.get_model("employees", model_name)
        for name in names:
            model.objects.get_or_create(name=name)


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0001_reference_lists"),
    ]

    operations = [
        migrations.RunPython(add_values, migrations.RunPython.noop),
    ]
