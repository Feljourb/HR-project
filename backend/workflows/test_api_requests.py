"""Tests de l'API des demandes : "My requests" et "Team approvals" (step 6a)."""
from django.urls import reverse
from rest_framework.test import APIClient

from employees.models import Department

from . import engine
from .models import Request
from .serializers import person
from .test_engine import EngineTestCase


def url(name, pk=None):
    """Ex. url("request-list"), url("approval-approve", 12)."""
    return reverse(f"workflows:{name}", args=[] if pk is None else [pk])


class RequestApiTests(EngineTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def login(self, employee):
        """Connecte ce collaborateur (mot de passe déjà changé)."""
        employee.user.must_change_password = False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def approvals(self):
        """Les titres des demandes qui attendent la personne connectée."""
        return [item["request"]["title"] for item in self.client.get(url("approval-list")).json()]

    def pending_id(self, demand):
        return demand.steps.get(status="PENDING").pk

    # --- My requests ------------------------------------------------------------------------

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(url("request-list")).status_code, 401)

    def test_i_see_only_my_requests(self):
        engine.submit("LEAVE", self.sara, "Congé de Sara")
        engine.submit("LEAVE", self.youssef, "Congé de Youssef")
        self.login(self.sara)
        self.assertEqual([item["title"] for item in self.client.get(url("request-list")).json()], ["Congé de Sara"])

    def test_someone_elses_request_is_a_404(self):
        demand = engine.submit("LEAVE", self.youssef, "Congé de Youssef")
        self.login(self.sara)
        self.assertEqual(self.client.get(url("request-detail", demand.pk)).status_code, 404)

    def test_a_request_shows_its_circuit(self):
        engine.submit("LEAVE", self.sara, "Congé")
        self.login(self.sara)
        item = self.client.get(url("request-list")).json()[0]
        self.assertEqual((item["workflow"], item["status"], item["requester"]), ("Congé", "IN_PROGRESS", person(self.sara)))
        first, second = item["steps"]
        self.assertEqual((first["approver_label"], first["status"], first["validator"]), ("N+1", "PENDING", person(self.youssef)))
        self.assertEqual((second["approver_label"], second["mode"], second["validator"]), ("RH du pôle", "INFORM", "RH du pôle"))

    # --- Annuler ---------------------------------------------------------------------------------

    def test_cancel_my_request(self):
        demand = engine.submit("LEAVE", self.sara, "Congé")
        self.login(self.sara)
        response = self.client.post(url("request-cancel", demand.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "CANCELLED")
        # Une deuxième fois : déjà terminée, un message clair (pas une erreur 500).
        again = self.client.post(url("request-cancel", demand.pk))
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json(), {"detail": "Cette demande est déjà terminée."})

    def test_cannot_cancel_someone_elses_request(self):
        demand = engine.submit("LEAVE", self.sara, "Congé")
        self.login(self.youssef)
        self.assertEqual(self.client.post(url("request-cancel", demand.pk)).status_code, 404)

    # --- Team approvals : qui voit quoi --------------------------------------------------------------

    def test_the_manager_sees_what_waits_for_him(self):
        engine.submit("LEAVE", self.sara, "Congé de Sara")
        self.login(self.youssef)
        self.assertEqual(self.approvals(), ["Congé de Sara"])
        self.login(self.karim)  # le N+2 : rien, ce n'est pas son tour
        self.assertEqual(self.approvals(), [])

    def test_every_hr_of_the_pole_sees_the_hr_steps_but_not_their_own(self):
        engine.submit("ADMIN_REQUEST", self.sara, "Attestation de Sara")
        engine.submit("ADMIN_REQUEST", self.nadia, "Attestation de Nadia")
        self.login(self.nadia)
        self.assertEqual(self.approvals(), ["Attestation de Sara"])
        self.login(self.hind)
        self.assertEqual(self.approvals(), ["Attestation de Sara", "Attestation de Nadia"])

    def test_hr_of_the_other_pole_sees_nothing(self):
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        riaya_hr = self.make_hr("rh.riaya", "AA100007", department=production, position=production.positions.first())
        engine.submit("ADMIN_REQUEST", self.sara, "Attestation de Sara")
        self.login(riaya_hr)
        self.assertEqual(self.approvals(), [])

    # --- Valider / refuser --------------------------------------------------------------------------

    def test_approve(self):
        demand = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.login(self.youssef)
        response = self.client.post(url("approval-approve", self.pending_id(demand)), {"comment": "OK"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "APPROVED")
        self.assertEqual(response.json()["steps"][0]["decided_by"], self.youssef.user.username)
        self.assertEqual(self.approvals(), [])  # plus rien n'attend Youssef

    def test_reject_without_comment_is_a_clear_400(self):
        demand = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.login(self.youssef)
        response = self.client.post(url("approval-reject", self.pending_id(demand)), {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Un commentaire est obligatoire pour refuser."})

    def test_reject(self):
        demand = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.login(self.youssef)
        self.client.post(url("approval-reject", self.pending_id(demand)), {"comment": "Justificatif manquant"}, format="json")
        demand.refresh_from_db()
        self.assertEqual(demand.status, Request.Status.REJECTED)

    def test_cannot_answer_a_step_that_does_not_wait_for_me(self):
        demand = engine.submit("EXPENSE", self.sara, "Note de frais")
        self.login(self.karim)  # pas son étape : il ne la voit même pas
        self.assertEqual(self.client.post(url("approval-approve", self.pending_id(demand))).status_code, 404)
