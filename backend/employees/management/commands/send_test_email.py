"""Envoie UN email de test, pour vérifier la configuration email (.env) :
    make test-email to=quelquun@exemple.com
En développement, il arrive dans la boîte de test Mailpit (http://localhost:8025), chez personne d'autre.
Avec le compte Microsoft 365 de l'IT (dans .env), il arrive vraiment à cette adresse."""
from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Envoie un email de test (vérifie la configuration email de .env)."

    def add_arguments(self, parser):
        parser.add_argument("to", help="L'adresse qui reçoit le test.")

    def handle(self, *args, to, **options):
        try:
            send_mail(
                subject="Intranet RH : email de test",
                message="Bonjour,\n\nCet email de test confirme que l'intranet RH sait envoyer des emails.\n\nIntranet RH",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[to],
            )
        except OSError as error:  # serveur injoignable, mauvais mot de passe, TLS...
            raise CommandError(f"Échec de l'envoi par {settings.EMAIL_HOST}:{settings.EMAIL_PORT} : {error}")
        self.stdout.write(self.style.SUCCESS(f"Email envoyé à {to} par {settings.EMAIL_HOST}:{settings.EMAIL_PORT}."))
        if settings.EMAIL_HOST == "mailpit":
            self.stdout.write("Boîte de test : http://localhost:8025")
