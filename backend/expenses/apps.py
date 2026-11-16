from django.apps import AppConfig


class ExpensesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'expenses'
    verbose_name = "Notes de frais"  # le titre de la section dans /admin

    def ready(self):
        # Enregistre le travail du matin : les taux de change mis à jour tout seuls (@on_morning_round).
        from . import rates  # noqa: F401
