from django.apps import AppConfig


class WorkflowsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'workflows'

    def ready(self):
        # P3 : enregistre le rappel "une demande attend ta réponse depuis 3 jours" (notify.remind_waiting_requests),
        # appelé quand quelqu'un ouvre la cloche.
        from . import notify  # noqa: F401
