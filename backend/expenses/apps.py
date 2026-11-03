from django.apps import AppConfig


class ExpensesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'expenses'
    verbose_name = "Notes de frais"  # le titre de la section dans /admin
