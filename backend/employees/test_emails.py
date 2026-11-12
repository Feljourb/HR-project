"""Tests des emails des notifications (le facteur : employees/emails.py)."""
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from workflows import engine
from workflows.models import Request
from workflows.test_engine import EngineTestCase

from .emails import MAX_ATTEMPTS, resend, send_pending
from .models import Employee, Notification, NotificationSettings
from .notifications import refresh_everyone


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

    def test_each_user_chooses_but_requests_to_approve_always_go(self):
        # Youssef (le N+1) coupe TOUS ses emails dans Settings : "à valider" part quand même.
        NotificationSettings.objects.create(user=self.youssef.user, email_results=False, email_info=False)
        self.submit()
        self.assertEqual(send_pending()["sent"], 1)
        # Sara coupe "le résultat de mes demandes" : l'acceptation n'est pas envoyée (la cloche l'a).
        NotificationSettings.objects.create(user=self.sara.user, email_results=False)
        request = self.sara_request()
        engine.approve(request.steps.get(status="PENDING"), self.youssef.user)
        counts = send_pending()
        approved = Notification.objects.get(recipient=self.sara.user, kind=Notification.Kind.APPROVED)
        self.assertEqual(approved.email_error, "Désactivé par l'utilisateur (Settings).")
        self.assertNotIn(self.sara.professional_email, [to for email in mail.outbox for to in email.to])
        self.assertGreaterEqual(counts["skipped"], 1)

    def sara_request(self):
        return Request.objects.filter(requester=self.sara).latest("id")

    def test_my_settings_api(self):
        self.sara.user.must_change_password = False
        self.sara.user.save()
        client = APIClient()
        client.force_authenticate(self.sara.user)
        url = reverse("employees:notification-email-settings")
        data = client.get(url).json()
        self.assertEqual((data["email_results"], data["email_info"], data["email_address"]), (True, True, self.sara.professional_email))
        self.assertFalse(client.patch(url, {"email_info": False}, format="json").json()["email_info"])
        self.assertFalse(NotificationSettings.objects.get(user=self.sara.user).email_info)  # seulement les siens

    def test_the_morning_round_makes_reminders_without_opening_the_bell(self):
        # Sara est en période d'essai, fin dans 5 jours : Nadia (RH du pôle) doit être prévenue,
        # même si elle n'ouvre jamais l'application (avant : le rappel naissait à l'ouverture de la cloche).
        Employee.objects.filter(pk=self.sara.pk).update(status=Employee.Status.TRIAL, trial_end_date=timezone.localdate() + timedelta(days=5))
        checked, errors = refresh_everyone()
        self.assertEqual(errors, [])
        self.assertGreater(checked, 0)
        trial = Notification.objects.filter(recipient=self.nadia.user, kind=Notification.Kind.TRIAL_END, employee=self.sara)
        self.assertEqual(trial.count(), 1)
        refresh_everyone()  # refait (ex. le facteur a redémarré) : pas de doublon
        self.assertEqual(trial.count(), 1)
        send_pending()
        self.assertIn(self.nadia.professional_email, [to for email in mail.outbox for to in email.to])

    def test_sent_even_if_already_read_or_old(self):
        notification = self.submit()
        # Déjà lue dans la cloche ET vieille de 3 jours (le facteur était arrêté) : l'email part QUAND MÊME.
        Notification.objects.filter(pk=notification.pk).update(read_at=timezone.now(), created_at=timezone.now() - timedelta(days=3))
        self.assertEqual(send_pending()["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_a_mail_server_down_is_retried_later_then_failed_then_resent(self):
        notification = self.submit()
        with mock.patch("django.core.mail.EmailMultiAlternatives.send", side_effect=OSError("Connection refused")):
            self.assertEqual(send_pending()["failed"], 1)
            notification.refresh_from_db()
            self.assertEqual((notification.emailed_at, notification.email_attempts), (None, 1))
            self.assertIn("Connection refused", notification.email_error)
            # Le prochain essai : dans 1 minute, pas tout de suite (on ne harcèle pas un serveur en panne).
            self.assertEqual(send_pending()["failed"], 0)
            # Plus d'une journée d'échecs : "Échec" (visible dans /admin), plus d'essai tout seul.
            Notification.objects.filter(pk=notification.pk).update(email_attempts=MAX_ATTEMPTS - 1, email_next_try=None)
            self.assertEqual(send_pending()["failed"], 1)
            notification.refresh_from_db()
            self.assertTrue(notification.email_error.startswith("Échec après 10 essais"))
            self.assertIsNone(notification.emailed_at)
            self.assertEqual(send_pending()["failed"], 0)
        # L'IT a réglé le problème et clique "Renvoyer l'email" : il part au passage suivant.
        self.assertEqual(resend(Notification.objects.filter(pk=notification.pk)), 1)
        self.assertEqual(send_pending()["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)
