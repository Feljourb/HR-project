"""Tests des emails des notifications (le facteur : employees/emails.py)."""
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone

from workflows import engine
from workflows.test_engine import EngineTestCase

from .emails import MAX_ATTEMPTS, send_pending
from .models import Notification


@override_settings(FRONTEND_URL="http://intranet.test")
class EmailTests(EngineTestCase):
    """Sara envoie une demande : son N+1 Youssef reçoit "Demande à valider" dans la cloche, puis par email."""

    def submit(self):
        engine.submit("LEAVE", self.sara, "Congé du 2 au 6 décembre")
        return Notification.objects.get(recipient=self.youssef.user, kind=Notification.Kind.TO_VALIDATE)

    def test_the_postman_sends_each_notification_once(self):
        self.submit()
        self.assertEqual(len(mail.outbox), 0)  # rien pendant la demande : c'est le facteur qui envoie
        self.assertEqual(send_pending()["sent"], 1)
        email = mail.outbox[0]
        self.assertTrue(self.youssef.professional_email)
        self.assertEqual(email.to, [self.youssef.professional_email])
        self.assertEqual(email.subject, "[Intranet RH] Demande à valider")
        self.assertIn("attend votre réponse : Congé du 2 au 6 décembre", email.body)
        self.assertIn("http://intranet.test/approvals", email.body)  # le bouton : la bonne page
        self.assertIn("text/html", email.alternatives[0][1])
        self.assertEqual(send_pending()["sent"], 0)  # jamais deux fois
        self.assertEqual(len(mail.outbox), 1)

    def test_not_sent_when_already_read_or_too_old(self):
        notification = self.submit()
        Notification.objects.filter(pk=notification.pk).update(read_at=timezone.now())
        self.assertEqual(send_pending()["skipped"], 1)
        notification.refresh_from_db()
        self.assertEqual(notification.email_error, "Déjà lue dans l'application.")
        # Une autre, vieille de 3 jours : plus d'actualité.
        Notification.objects.filter(pk=notification.pk).update(
            read_at=None, emailed_at=None, created_at=timezone.now() - timedelta(days=3))
        self.assertEqual(send_pending()["skipped"], 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_mail_server_down_is_retried_then_given_up(self):
        notification = self.submit()
        with mock.patch("django.core.mail.EmailMultiAlternatives.send", side_effect=OSError("Connection refused")):
            self.assertEqual(send_pending()["failed"], 1)
            notification.refresh_from_db()
            # Elle attend le passage suivant (la cloche l'a déjà).
            self.assertEqual((notification.emailed_at, notification.email_attempts), (None, 1))
            self.assertIn("Connection refused", notification.email_error)
            Notification.objects.filter(pk=notification.pk).update(email_attempts=MAX_ATTEMPTS - 1)
            send_pending()
        notification.refresh_from_db()
        self.assertIsNotNone(notification.emailed_at)  # le dernier essai raté : abandonnée
        self.assertEqual(send_pending()["sent"], 0)
