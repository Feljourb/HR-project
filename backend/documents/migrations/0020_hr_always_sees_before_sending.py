"""2026-11-17 : les RH voient TOUJOURS un document généré avant qu'il parte ("Prepare" -> Send / Print), même signé par
l'application. La case "Relecture RH avant l'envoi" n'a donc plus de sens dans l'écran : décochée partout (le champ
reste dans la base ; ses tests le cochent eux-mêmes)."""
from django.db import migrations


def uncheck(apps, schema_editor):
    apps.get_model("documents", "DocumentType").objects.update(hr_review=False)


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0019_original_only_by_default'),
    ]

    operations = [
        migrations.RunPython(uncheck, migrations.RunPython.noop),
    ]
