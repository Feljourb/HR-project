from django.apps import AppConfig


class LeavesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'leaves'
    verbose_name = "Congés"  # le titre de la section dans /admin

    def ready(self):
        # Au démarrage de Django : on importe les handlers, ce qui inscrit @on_approved("LEAVE") dans le moteur.
        # Sans cet import, le moteur ne saurait pas que le module Congés existe.
        from . import handlers  # noqa: F401
