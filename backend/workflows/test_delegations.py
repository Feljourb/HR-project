"""Un valideur absent (décision de l'utilisateur, 2026-11-12, à la place des 3 niveaux du 2026-11-09) :
SEULEMENT le délégué qu'il a choisi (n'importe qui de son pôle) répond à sa place. Sans délégué, personne ne le
remplace (ni son responsable, ni les RH) : la demande l'attend (le module Congés prévient à J-2 et annule à J)."""
import datetime
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Department, Notification, Pole

from . import engine
from .delegations import create_delegation, end_delegation
from .test_engine import EngineTestCase

User = get_user_model()


def days(n):
    return timezone.localdate() + datetime.timedelta(days=n)


class DelegationTests(EngineTestCase):
    """Sara (Ventes) -> N+1 Youssef -> N+2 Karim (directeur, pas le DG). Nadia et Hind : RH de SBD."""

    def setUp(self):
        super().setUp()
        self.omar = self.make_employee("omar.peer", "AA100030")  # un autre manager du pôle (le délégué)
        self.omar.user.role = User.Role.MANAGER
        self.omar.user.save()
        self.request = engine.submit("LEAVE", self.sara, "Congé de Sara")
        self.step = self.request.steps.get(status="PENDING")  # étape N+1 : Youssef

    def absent(self, *employees):
        """Comme si ces personnes étaient en congé accepté aujourd'hui (le module Congés le dit au moteur)."""
        ids = {employee.pk for employee in employees}
        return mock.patch.object(engine, "ABSENCE_CHECKS", [lambda employee, day: employee.pk in ids])

    # --- Niveau 1 : le délégué -------------------------------------------------------------

    def test_the_delegate_answers_on_behalf_of_the_absent(self):
        create_delegation(self.youssef, self.omar, days(0), days(5), self.youssef.user)
        # 🔔 Omar est prévenu, et reçoit la demande qui attendait déjà.
        self.assertTrue(Notification.objects.filter(recipient=self.omar.user, kind="DELEGATED").exists())
        self.assertTrue(Notification.objects.filter(recipient=self.omar.user, kind="TO_VALIDATE", request=self.request).exists())
        self.assertIn(self.step, engine.steps_waiting_for(self.omar.user))
        engine.approve(self.step, self.omar.user, "OK pour moi")
        self.step.refresh_from_db()
        self.assertEqual((self.step.decided_by, self.step.on_behalf_of), (self.omar.user, self.youssef))
        # 🔔 + email à Youssef (l'absent) : qui a répondu en son nom, et le commentaire.
        from employees.notifications import message
        told = Notification.objects.get(recipient=self.youssef.user, kind="ANSWERED_FOR", request=self.request)
        self.assertIn("a validé en votre nom", message(told))
        self.assertIn("OK pour moi", message(told))

    def test_the_absent_can_still_answer(self):
        create_delegation(self.youssef, self.omar, days(0), days(5), self.youssef.user)
        engine.approve(self.step, self.youssef.user)
        self.step.refresh_from_db()
        self.assertIsNone(self.step.on_behalf_of)  # Youssef a répondu lui-même
        self.assertFalse(Notification.objects.filter(kind="ANSWERED_FOR").exists())  # rien à lui dire

    def test_a_future_or_ended_delegation_changes_nothing(self):
        planned = create_delegation(self.youssef, self.omar, days(3), days(5), self.youssef.user)
        self.assertNotIn(self.step, engine.steps_waiting_for(self.omar.user))
        end_delegation(planned, self.youssef.user)
        now = create_delegation(self.youssef, self.omar, days(0), days(2), self.youssef.user)
        end_delegation(now, self.youssef.user)
        self.assertFalse(engine.can_decide(self.omar.user, self.step))

    def test_nobody_validates_their_own_request(self):
        self.sara.user.role = User.Role.MANAGER  # même une déléguée autorisée ne valide pas SA demande
        self.sara.user.save()
        create_delegation(self.youssef, self.sara, days(0), days(5), self.youssef.user)
        self.assertFalse(engine.can_decide(self.sara.user, self.step))

    def test_the_delegate_is_anyone_of_the_same_pole(self):
        # Un collaborateur du pôle : permis (au choix de l'absent, décision du 2026-11-12). Il valide "on behalf of".
        colleague = self.make_employee("ali.collab", "AA100031")
        create_delegation(self.youssef, colleague, days(0), days(2), self.youssef.user)
        self.assertIn(self.step, engine.steps_waiting_for(colleague.user))
        # Sa cloche (et son email) mènent à SA page "Stand-in requests" (il n'a pas "Team approvals").
        from employees.notifications import link
        self.assertEqual(link(Notification.objects.get(recipient=colleague.user, kind="TO_VALIDATE")), "/stand-in")
        self.assertEqual(link(Notification.objects.get(recipient=self.youssef.user, kind="TO_VALIDATE")), "/approvals")
        # Quelqu'un de l'AUTRE pôle : refusé. La recherche ne le propose pas.
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        riaya = self.make_employee("rida.riaya", "AA100032", department=production, position=production.positions.first())
        with self.assertRaisesMessage(ValidationError, "même pôle"):
            create_delegation(self.youssef, riaya, days(10), days(12), self.youssef.user)
        client = APIClient()
        self.youssef.user.must_change_password = False
        self.youssef.user.save()
        client.force_authenticate(self.youssef.user)
        found = [person["id"] for person in client.get(reverse("workflows:delegation-candidates")).json()]
        self.assertIn(colleague.pk, found)
        self.assertNotIn(riaya.pk, found)
        self.assertNotIn(self.youssef.pk, found)

    # --- Sans délégué : personne ne remplace (décision du 2026-11-12) --------------------------

    def test_absent_without_delegate_nobody_replaces(self):
        Pole.objects.filter(pk=self.sara.pole.pk).update(director=self.karim)
        self.sara.refresh_from_db()
        with self.absent(self.youssef, self.karim):
            # Ni son responsable, ni les RH : la demande attend Youssef.
            for other in (self.karim, self.nadia, self.hind):
                self.assertFalse(engine.can_decide(other.user, self.step))
                self.assertNotIn(self.step, engine.steps_waiting_for(other.user))
            # Youssef peut répondre même en congé.
            engine.approve(self.step, self.youssef.user)
        self.step.refresh_from_db()
        self.assertIsNone(self.step.on_behalf_of)

    # --- P3 : le rappel "une demande attend ta réponse depuis 3 jours" ----------------------

    def test_a_reminder_after_3_days_once(self):
        from employees.notifications import message, refresh_for

        refresh_for(self.youssef.user)  # le jour même : pas de rappel
        self.assertFalse(Notification.objects.filter(recipient=self.youssef.user, kind="REMINDER").exists())
        later = timezone.localdate() + datetime.timedelta(days=4)
        with mock.patch("django.utils.timezone.localdate", lambda *args, **kwargs: later):
            refresh_for(self.youssef.user)
            refresh_for(self.youssef.user)  # la cloche ouverte 2 fois : un seul rappel
            reminder = Notification.objects.get(recipient=self.youssef.user, kind="REMINDER")
            self.assertIn("attend votre réponse depuis 4 jours", message(reminder))
        # Youssef répond : le rappel pas encore lu s'en va.
        engine.approve(self.step, self.youssef.user)
        self.assertFalse(Notification.objects.filter(recipient=self.youssef.user, kind="REMINDER").exists())

    # --- Les règles ----------------------------------------------------------------------

    def test_who_can_set_a_delegation_and_the_rules(self):
        # Les RH du pôle le font pour quelqu'un (ex. une absence soudaine) ; un collègue, non.
        create_delegation(self.youssef, self.omar, days(10), days(12), self.nadia.user)
        with self.assertRaises(PermissionDenied):
            create_delegation(self.youssef, self.omar, days(20), days(22), self.sara.user)
        # Une seule à la fois sur les mêmes dates ; pas à soi-même ; pas dans le passé.
        with self.assertRaisesMessage(ValidationError, "existe déjà"):
            create_delegation(self.youssef, self.nadia, days(11), days(15), self.youssef.user)
        with self.assertRaises(ValidationError):
            create_delegation(self.youssef, self.youssef, days(30), days(31), self.youssef.user)
        with self.assertRaises(ValidationError):
            create_delegation(self.youssef, self.omar, days(-5), days(-1), self.youssef.user)

    def test_the_api(self):
        client = APIClient()
        for employee in (self.youssef, self.omar):
            employee.user.must_change_password = False
            employee.user.save()
        client.force_authenticate(self.youssef.user)
        url = reverse("workflows:delegation-list")
        response = client.post(url, {"delegate": self.omar.pk, "start_date": days(0).isoformat(), "end_date": days(3).isoformat()})
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual((response.json()["state"], response.json()["delegate"]), ("ACTIVE", self.omar.pk))
        # Omar : la délégation reçue ; dans Team approvals, "On behalf of Youssef".
        client.force_authenticate(self.omar.user)
        self.assertEqual(len(client.get(url).json()), 1)
        approvals = client.get(reverse("workflows:approval-list")).json()
        self.assertEqual(approvals[0]["on_behalf_of"], f"{self.youssef.first_name} {self.youssef.last_name.title()}")
        # /me dit au menu qu'Omar remplace quelqu'un (lien "Stand-in requests" pour un collaborateur).
        self.assertTrue(client.get(reverse("accounts:me")).json()["stands_in"])
        # Omar valide : la demande quitte "à valider" et entre dans SON historique de remplaçant.
        answered = reverse("workflows:approval-answered-for")
        self.assertEqual(client.get(answered).json(), [])
        client.post(reverse("workflows:approval-approve", args=[approvals[0]["id"]]), {"comment": "Vu"})
        history = client.get(answered).json()
        self.assertEqual([(item["request"]["id"], item["status"], item["comment"]) for item in history],
                         [(self.request.pk, "APPROVED", "Vu")])
        # "End now" par Youssef.
        client.force_authenticate(self.youssef.user)
        ended = client.post(reverse("workflows:delegation-end", args=[response.json()["id"]]))
        self.assertEqual(ended.json()["state"], "ENDED")
        # Délégation finie : le lien reste, pour retrouver l'historique de ce qu'Omar a répondu.
        client.force_authenticate(self.omar.user)
        self.assertTrue(client.get(reverse("accounts:me")).json()["stands_in"])
