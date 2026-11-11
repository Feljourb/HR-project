"""Le facteur des emails : envoie les notifications en attente (voir employees/emails.py).
    python manage.py send_emails            -> un seul passage (ex. pour essayer)
    python manage.py send_emails --loop 30  -> toutes les 30 secondes, sans s'arrêter (le service "mailer")"""
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from employees.emails import send_pending


class Command(BaseCommand):
    help = "Envoie par email les notifications en attente (une fois, ou en boucle avec --loop)."

    def add_arguments(self, parser):
        parser.add_argument("--loop", type=int, default=0, metavar="SECONDES",
                            help="Recommencer toutes les N secondes (0 = un seul passage).")

    def handle(self, *args, loop, **options):
        while True:
            close_old_connections()  # une connexion à la base coupée pendant l'attente : on en reprend une
            try:
                counts = send_pending()
                if any(counts.values()) or not loop:
                    self.stdout.write(f"Emails : {counts['sent']} envoyé(s), {counts['skipped']} non envoyé(s), {counts['failed']} échec(s).")
            except Exception as error:  # la base pas encore prête... : le facteur ne s'arrête pas pour ça
                self.stderr.write(f"Erreur du facteur : {error}")
            if not loop:
                return
            time.sleep(loop)
