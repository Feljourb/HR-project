"""Tests des notifications de la cloche pour les demandes (step 7)."""
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Notification

from . import engine
from .test_engine import EngineTestCase

Kind = Notification.Kind


class RequestNotificationTests(EngineTestCase):
    def bell(self, employee):
        """Les notifications d'un collaborateur, en clair : [(type, titre de la demande, lue ?)]."""
        return [(n.kind, n.request.title, n.read_at is not None)
                for n in Notification.objects.filter(recipient=employee.user).order_by("id")]

    def pending(self, request):
        return request.steps.get(status="PENDING")

    # --- Qui reçoit quoi -------------------------------------------------------------------

    def test_the_manager_is_told_a_request_waits_for_him(self):
        engine.submit("LEAVE", self.sara, "Congé")
        self.assertEqual(self.bell(self.youssef), [(Kind.TO_VALIDATE, "Congé", False)])
        for other in (self.sara, self.karim, self.nadia):  # personne d'autre pour l'instant
            self.assertEqual(self.bell(other), [])

    def test_approved_leave_informs_hr_and_tells_the_requester(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        engine.approve(self.pending(request), self.youssef.user)
        self.assertEqual(self.bell(self.youssef), [])                      # sa demande à valider est partie
        self.assertEqual(self.bell(self.nadia), [(Kind.INFORMED, "Congé", False)])
        self.assertEqual(self.bell(self.hind), [(Kind.INFORMED, "Congé", False)])
        self.assertEqual(self.bell(self.sara), [(Kind.APPROVED, "Congé", False)])

    def test_rejected_request_tells_the_requester_with_the_reason(self):
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        engine.reject(self.pending(request), self.youssef.user, "Justificatif manquant")
        notification = Notification.objects.get(recipient=self.sara.user)
        self.assertEqual(notification.kind, Kind.REJECTED)
        self.assertEqual(self.bell(self.nadia), [])  # refusée : la RH n'est pas informée

    def test_every_hr_of_the_pole_is_told_then_it_disappears_when_one_answers(self):
        request = engine.submit("ADMIN_REQUEST", self.sara, "Attestation")
        self.assertEqual(self.bell(self.nadia), [(Kind.TO_VALIDATE, "Attestation", False)])
        self.assertEqual(self.bell(self.hind), [(Kind.TO_VALIDATE, "Attestation", False)])
        engine.approve(self.pending(request), self.nadia.user)
        self.assertEqual(self.bell(self.hind), [])  # Nadia a répondu : plus rien à valider pour Hind

    def test_a_read_notification_stays_as_history(self):
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        Notification.objects.filter(recipient=self.youssef.user).update(read_at=timezone.now())
        engine.approve(self.pending(request), self.youssef.user)
        self.assertEqual(self.bell(self.youssef), [(Kind.TO_VALIDATE, "Note de frais", True)])

    def test_cancel_removes_what_waits(self):
        request = engine.submit("LEAVE", self.sara, "Congé")
        engine.cancel(request, self.sara.user)
        self.assertEqual(self.bell(self.youssef), [])

    def test_the_requester_is_never_told_to_validate_their_own_request(self):
        engine.submit("ADMIN_REQUEST", self.nadia, "Attestation de Nadia")
        self.assertEqual(self.bell(self.nadia), [])
        self.assertEqual(self.bell(self.hind), [(Kind.TO_VALIDATE, "Attestation de Nadia", False)])

    # --- Ce que la cloche affiche ----------------------------------------------------------------

    def test_the_bell_shows_the_message_and_the_page_to_open(self):
        request = engine.submit("EXPENSE", self.sara, "Note de frais")
        client = APIClient()
        self.youssef.user.must_change_password = False
        self.youssef.user.save()
        client.force_authenticate(self.youssef.user)
        item = client.get(reverse("employees:notification-list")).json()["results"][0]
        self.assertEqual(item["title"], "Demande à valider")
        self.assertIn("attend votre réponse : Note de frais.", item["message"])
        self.assertEqual(item["link"], "/approvals")

        engine.reject(self.pending(request), self.youssef.user, "Justificatif manquant")
        self.sara.user.must_change_password = False
        self.sara.user.save()
        client.force_authenticate(self.sara.user)
        item = client.get(reverse("employees:notification-list")).json()["results"][0]
        self.assertEqual(item["message"], "Votre demande a été refusée : Note de frais. Motif : Justificatif manquant")
        self.assertEqual(item["link"], "/requests")
