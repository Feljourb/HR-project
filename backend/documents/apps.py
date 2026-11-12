from django.apps import AppConfig


class DocumentsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'documents'
    verbose_name = "Documents administratifs"  # le titre de la section dans /admin

    def ready(self):
        # Enregistre @on_approved("ADMIN_REQUEST") : une demande acceptée -> le document est généré (ou attendu).
        from . import handlers  # noqa: F401
