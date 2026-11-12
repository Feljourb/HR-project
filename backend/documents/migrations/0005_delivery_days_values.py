"""Le délai de chaque type (standard, à confirmer par les RH ; Admin RH le change sur la page Lists) :
le document généré par l'application est prêt tout de suite (0) ; les autres en 2 jours ouvrés."""
from django.db import migrations


def set_delays(apps, schema_editor):
    DocumentType = apps.get_model("documents", "DocumentType")
    DocumentType.objects.exclude(template="").update(delivery_days=0)


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0004_delivery_days_and_on_behalf'),
    ]

    operations = [
        migrations.RunPython(set_delays, migrations.RunPython.noop),
    ]
