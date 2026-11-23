from django.apps import AppConfig


class JourneysConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'journeys'
    verbose_name = "Arrivées et départs"  # le titre de la section dans /admin

    def ready(self):
        # Enregistre @on_bell_refresh : le rappel des tâches en retard (comme les autres rappels).
        from . import handlers  # noqa: F401
