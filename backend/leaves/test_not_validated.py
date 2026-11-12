"""Un congé pas encore validé (décision de l'utilisateur, 2026-11-12) : sans délégué, personne ne remplace le N+1
absent. 2 jours avant le début : le demandeur et les RH sont prévenus ; le jour du début : annulé automatiquement."""
import datetime
from unittest import mock

from employees.models import Notification
from employees.notifications import message, refresh_everyone, refresh_for
from workflows import engine
from workflows.models import Request
from workflows.test_engine import EngineTestCase

from .balance import balance
from .handlers import EXPIRED_REASON
from .models import LeaveType
from .services import request_leave
from .tests import freeze_today

Kind = Notification.Kind


def on_day(day):
    """ "Aujourd'hui" = ce jour de novembre 2026."""
    return mock.patch("django.utils.timezone.localdate", lambda *args, **kwargs: datetime.date(2026, 11, day))


class NotValidatedTests(EngineTestCase):
    """Aujourd'hui = lundi 02/11/2026. Sara demande du mercredi 04/11 au vendredi 06/11 ; son N+1 Youssef ne répond pas.
    Nadia et Hind : RH de SBD."""

    def setUp(self):
        freeze_today(self)
        super().setUp()
        annual = LeaveType.objects.get(name="Congé annuel")
        self.leave = request_leave(self.sara, annual, datetime.date(2026, 11, 4), datetime.date(2026, 11, 6))
        self.request = self.leave.request

    def notices(self, kind):
        return set(Notification.objects.filter(kind=kind, request=self.request).values_list("recipient__username", flat=True))

    def test_two_days_before_the_requester_and_hr_are_told(self):
        for user in (self.sara.user, self.youssef.user, self.nadia.user, self.hind.user):
            refresh_for(user)
        # Sara (elle peut appeler Youssef, ou décaler) et les RH du pôle ; pas Youssef (il a déjà "à valider" + rappels).
        self.assertEqual(self.notices(Kind.NOT_VALIDATED), {self.sara.user.username, self.nadia.user.username, self.hind.user.username})
        mine = Notification.objects.get(kind=Kind.NOT_VALIDATED, recipient=self.sara.user)
        self.assertEqual(mine.due_date, datetime.date(2026, 11, 4))
        self.assertIn("sera annulée automatiquement", message(mine))
        hr = Notification.objects.get(kind=Kind.NOT_VALIDATED, recipient=self.nadia.user)
        self.assertIn(f"en attente de {self.youssef.first_name}", message(hr))
        refresh_for(self.sara.user)  # la cloche rouverte : pas de doublon
        self.assertEqual(Notification.objects.filter(kind=Kind.NOT_VALIDATED, recipient=self.sara.user).count(), 1)
        # Youssef valide : les "pas encore validée" pas lues s'en vont.
        engine.approve(self.request.steps.get(status="PENDING"), self.youssef.user)
        self.assertEqual(self.notices(Kind.NOT_VALIDATED), set())

    def test_nothing_before_two_days(self):
        with on_day(1):
            refresh_for(self.sara.user)
        self.assertEqual(self.notices(Kind.NOT_VALIDATED), set())

    def test_on_the_first_day_it_is_cancelled_and_the_days_come_back(self):
        self.assertEqual(balance(self.sara)["pending"], 2)  # réservés pendant l'attente (le 06/11, Marche Verte, est férié)
        with on_day(3):
            refresh_everyone()  # la veille : encore en attente, rien ne change
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, Request.Status.IN_PROGRESS)
        with on_day(4):
            checked, errors = refresh_everyone()  # le tour du matin du premier jour
            self.assertEqual(errors, [])
            self.request.refresh_from_db()
            self.assertEqual((self.request.status, self.request.cancel_reason), (Request.Status.CANCELLED, EXPIRED_REASON))
            self.assertIsNone(self.request.cancelled_by)  # personne n'a cliqué : l'application
            self.assertEqual(balance(self.sara)["pending"], 0)  # les jours sont rendus
        # Prévenus : Sara, Youssef (il ne peut plus valider), les RH du pôle (+ Admin RH s'il y en a).
        self.assertTrue({self.sara.user.username, self.youssef.user.username, self.nadia.user.username} <= self.notices(Kind.EXPIRED))
        expired = Notification.objects.get(kind=Kind.EXPIRED, recipient=self.sara.user)
        self.assertIn("annulée automatiquement", message(expired))
        # Plus rien à valider pour Youssef.
        self.assertFalse(engine.steps_waiting_for(self.youssef.user).exists())
        self.assertFalse(Notification.objects.filter(kind=Kind.TO_VALIDATE, request=self.request, read_at__isnull=True).exists())
