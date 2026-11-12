"""Le facteur des emails : envoie les notifications en attente (voir employees/emails.py).
    python manage.py send_emails              -> un seul passage (ex. pour essayer)
    python manage.py send_emails --reminders  -> le tour des rappels MAINTENANT, puis un passage (pour essayer)
    python manage.py send_emails --loop 30    -> toutes les 30 secondes, sans s'arrêter (le service "mailer")

Le tour du matin (step 4, 2026-11-12) : avec --loop, une fois par jour à partir de MORNING_HOUR, les rappels
de TOUS les comptes sont calculés (notifications.refresh_everyone : 31/12, demandes en attente, fins d'essai),
comme si chacun ouvrait sa cloche ; le facteur les envoie ensuite par email comme les autres."""
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from employees.emails import send_pending
from employees.notifications import refresh_everyone

MORNING_HOUR = 8  # le tour des rappels : chaque jour à partir de 8 h (heure du Maroc)


class Command(BaseCommand):
    help = "Envoie par email les notifications en attente (une fois, ou en boucle avec --loop)."

    def add_arguments(self, parser):
        parser.add_argument("--loop", type=int, default=0, metavar="SECONDES",
                            help="Recommencer toutes les N secondes (0 = un seul passage).")
        parser.add_argument("--reminders", action="store_true", help="Faire le tour des rappels tout de suite.")

    def handle(self, *args, loop, reminders, **options):
        last_round = None  # le jour du dernier tour des rappels (le refaire après un redémarrage : pas de doublon)
        while True:
            close_old_connections()  # une connexion à la base coupée pendant l'attente : on en reprend une
            try:
                now = timezone.localtime()
                if reminders or (loop and last_round != now.date() and now.hour >= MORNING_HOUR):
                    checked, errors = refresh_everyone()
                    last_round, reminders = now.date(), False
                    self.stdout.write(f"Tour des rappels : {checked} compte(s) vérifié(s).")
                    for error in errors:
                        self.stderr.write(f"Rappels, erreur pour {error}")
                counts = send_pending()
                if any(counts.values()) or not loop:
                    self.stdout.write(f"Emails : {counts['sent']} envoyé(s), {counts['skipped']} non envoyé(s), {counts['failed']} échec(s).")
            except Exception as error:  # la base pas encore prête... : le facteur ne s'arrête pas pour ça
                self.stderr.write(f"Erreur du facteur : {error}")
            if not loop:
                return
            time.sleep(loop)
