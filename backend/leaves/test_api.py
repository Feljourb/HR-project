"""Tests de l'API des congés (step 6), des pages RH (step 8) et de la commande de démo (step 9)."""
import datetime
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Department, Employee, Notification
from employees.notifications import message as bell_message
from workflows import engine
from workflows.test_engine import EngineTestCase

from .balance import balance
from .models import LeaveRequest, LeaveType, PublicHoliday
from .tests import freeze_today, frozen_localdate
from .services import request_leave

User = get_user_model()


def url(name):
    """Ex. url("mine-list"), url("mine-preview")."""
    return reverse(f"leaves:{name}")


def form(leave_type, start, end, **extra):
    """Ce que le formulaire envoie. Novembre 2026 : vendredi 6 = Marche Verte."""
    return {"leave_type": leave_type.pk, "start_date": f"2026-11-{start:02d}", "end_date": f"2026-11-{end:02d}", **extra}


class LeaveApiTests(EngineTestCase):
    def setUp(self):
        # "Aujourd'hui" figé au 02/11/2026 (comme les autres tests des congés) : les dates de novembre restent dans
        # le futur quel que soit le jour où on lance les tests (sinon la règle "pas dans le passé" les refuserait).
        freeze_today(self)
        super().setUp()
        self.annual = LeaveType.objects.get(name="Congé annuel")
        self.client = APIClient()
        self.login(self.sara)

    def login(self, employee):
        employee.user.must_change_password = False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def test_anonymous_is_refused(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(url("mine-list")).status_code, 401)

    def test_lists_for_the_form(self):
        LeaveType.objects.filter(name="Congé sans solde").update(is_active=False)
        names = [item["name"] for item in self.client.get(url("type-list")).json()]
        self.assertIn("Congé annuel", names)
        self.assertNotIn("Congé sans solde", names)  # désactivé : plus proposé
        holidays = self.client.get(url("holiday-list"), {"year": 2027}).json()
        # 11 fixes + 6 religieuses créées toutes seules : en 2027, le Mawlid (14/08) tombe le jour de
        # l'Allégeance Oued Ed-Dahab, déjà férié (un seul jour férié par date).
        self.assertEqual(len(holidays), 17)
        self.assertTrue(all(item["date"].startswith("2027") for item in holidays))

    def test_preview_explains_the_count_and_the_balance_after(self):
        data = self.client.post(url("mine-preview"), form(self.annual, 5, 9)).json()
        self.assertEqual(data["days"], 2.5)  # jeudi 1 + férié 0 + samedi 0,5 + dimanche 0 + lundi 1
        self.assertEqual(data["detail"][1], {"date": "2026-11-06", "days": 0.0, "holiday": "Marche Verte"})
        self.assertEqual(data["balance_after"], data["balance"]["available"] - 2.5)
        self.assertIsNone(data["error"])
        self.assertFalse(LeaveRequest.objects.exists())  # un aperçu n'enregistre rien

    def test_preview_shows_the_rule_that_would_block(self):
        wedding = LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié")
        data = self.client.post(url("mine-preview"), form(wedding, 9, 13)).json()
        self.assertIn("4 jour(s) au maximum", data["error"])
        self.assertIsNone(data["balance_after"])  # pas pris sur le solde

    def test_an_unfinished_year_is_refused_and_creates_nothing(self):
        # Bug du 2026-11-03 : pendant qu'on tape "2026", la date vaut 0002-11-10, puis 0020-11-10...
        data = {"leave_type": self.annual.pk, "start_date": "0002-11-10", "end_date": "2026-11-12"}
        response = self.client.post(url("mine-preview"), data)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Année impossible", response.json()["start_date"][0])
        self.assertFalse(PublicHoliday.objects.filter(date__year__lt=2000).exists())

    def test_send_a_leave_and_see_it_in_my_leaves(self):
        response = self.client.post(url("mine-list"), form(self.annual, 23, 27, reason="Vacances"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.json()["days"], response.json()["status"]), (5, "IN_PROGRESS"))
        mine = self.client.get(url("mine-list")).json()
        self.assertEqual([item["leave_type_label"] for item in mine], ["Congé annuel"])
        self.assertEqual(self.client.get(url("mine-balance")).json()["pending"], 5)
        # Youssef ne voit pas les congés de Sara dans SES congés.
        self.login(self.youssef)
        self.assertEqual(self.client.get(url("mine-list")).json(), [])

    def test_a_refused_rule_is_a_clear_400(self):
        self.client.post(url("mine-list"), form(self.annual, 23, 27))
        response = self.client.post(url("mine-list"), form(self.annual, 26, 30))
        self.assertEqual(response.status_code, 400)
        self.assertIn("déjà un congé sur ces dates", response.json()["detail"])
        bad = self.client.post(url("mine-list"), {"leave_type": self.annual.pk, "start_date": "pas une date"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("end_date", bad.json())  # le champ manquant

    def test_cancel_through_the_engine_frees_the_days(self):
        leave = self.client.post(url("mine-list"), form(self.annual, 23, 27)).json()
        response = self.client.post(reverse("workflows:request-cancel", args=[leave["request"]]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get(url("mine-list")).json()[0]["status"], "CANCELLED")
        self.assertEqual(self.client.get(url("mine-balance")).json()["pending"], 0)

    def test_an_account_without_a_fiche(self):
        it = User.objects.create_user("it.support", is_superuser=True, must_change_password=False)
        self.client.force_authenticate(it)
        self.assertEqual(self.client.get(url("mine-balance")).status_code, 404)
        self.assertEqual(self.client.get(url("mine-list")).json(), [])


@override_settings(DEBUG=True)
class DemoCommandTests(TestCase):
    def test_make_seed_leaves(self):
        call_command("seed_test_fiches", stdout=StringIO())  # make seed : les comptes de test et leurs dossiers
        out = StringIO()
        call_command("seed_leaves", stdout=out)
        statuses = sorted(LeaveRequest.objects.values_list("request__status", flat=True))
        self.assertEqual(statuses, ["APPROVED", "APPROVED", "IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "REJECTED"], out.getvalue())
        # Relancée : rien de nouveau.
        again = StringIO()
        call_command("seed_leaves", stdout=again)
        self.assertEqual(LeaveRequest.objects.count(), 6)
        self.assertIn("déjà envoyé, ignoré", again.getvalue())

    @override_settings(DEBUG=False)
    def test_never_in_production(self):
        with self.assertRaisesMessage(Exception, "Réservé au développement"):
            call_command("seed_leaves", stdout=StringIO())


class HrLeaveApiTests(EngineTestCase):
    """Step 8 : les absences (RH) et les deux listes du module (Admin RH)."""

    def setUp(self):
        freeze_today(self)  # voir LeaveApiTests
        super().setUp()
        self.annual = LeaveType.objects.get(name="Congé annuel")
        self.client = APIClient()
        # Salma travaille à Riaya (l'autre pôle) ; Sara à SBD.
        production = Department.objects.get(name="Production", direction__entity__name="Eureka")
        self.salma = self.make_employee("salma.riaya", "AA100010", department=production, position=production.positions.first())
        request_leave(self.sara, self.annual, datetime.date(2026, 11, 23), datetime.date(2026, 11, 27))
        request_leave(self.salma, self.annual, datetime.date(2026, 11, 2), datetime.date(2026, 11, 3))
        cancelled = request_leave(self.sara, self.annual, datetime.date(2026, 11, 9), datetime.date(2026, 11, 9))
        cancelled.request.status = "CANCELLED"
        cancelled.request.save()

    def as_role(self, employee, role):
        employee.user.role, employee.user.must_change_password = role, False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def absences(self, **period):
        return self.client.get(url("absence-list"), {"date_from": "2026-11-01", "date_to": "2026-11-30", **period})

    def test_hr_sees_the_absences_of_their_pole_only(self):
        self.as_role(self.nadia, User.Role.HR)  # RH de SBD
        rows = self.absences().json()
        self.assertEqual([(row["employee"], row["days"], row["status"]) for row in rows],
                         [(f"{self.sara.first_name} {self.sara.last_name.title()}", 5, "IN_PROGRESS")])  # ni Riaya, ni l'annulé
        self.assertEqual(rows[0]["department"], "Ventes")

    def test_hr_sees_the_balances_of_their_pole(self):
        # P1 step 1 : la page "Leave balances". Les chiffres = ceux de la page du collaborateur (balance()).
        self.as_role(self.nadia, User.Role.HR)  # RH de SBD : pas Salma (Riaya)
        rows = {row["employee_id"]: row for row in self.client.get(url("balances-list")).json()}
        self.assertNotIn(self.salma.pk, rows)
        sara = rows[self.sara.pk]
        self.assertEqual((sara["department"], sara["yearly_right"]), ("Ventes", 18))
        self.assertEqual(sara["pending"], 5)  # 23 -> 27/11 en cours (l'annulé ne compte pas)
        self.assertEqual(sara["available"], float(balance(self.sara)["available"]))
        # Un "Sorti" : caché, sauf avec ?left=1 (ses jours restants pour le solde de tout compte).
        Employee.objects.filter(pk=self.youssef.pk).update(status=Employee.Status.LEFT, departure_date=datetime.date(2026, 10, 31))
        self.assertNotIn(self.youssef.pk, [row["employee_id"] for row in self.client.get(url("balances-list")).json()])
        self.assertIn(self.youssef.pk, [row["employee_id"] for row in self.client.get(url("balances-list"), {"left": "1"}).json()])
        # Admin RH : les deux pôles. Un collaborateur : non.
        self.as_role(self.nadia, User.Role.HR_ADMIN)
        self.assertIn(self.salma.pk, [row["employee_id"] for row in self.client.get(url("balances-list")).json()])
        self.as_role(self.sara, User.Role.COLLABORATOR)
        self.assertEqual(self.client.get(url("balances-list")).status_code, 403)

    @mock.patch("django.utils.timezone.localdate", frozen_localdate)  # "aujourd'hui" = 02/11/2026
    def test_the_annual_right_changes_from_a_date(self):
        # P1 step 2 : Sara (embauchée le 05/01/2026, 18 j) passe à 30 j à partir du 01/09/2026.
        self.as_role(self.nadia, User.Role.HR)
        detail = reverse("leaves:balances-detail", args=[self.sara.pk])
        self.assertEqual(self.client.get(detail).json()["acquired"], 13.5)  # 9 mois x 1,5
        response = self.client.post(reverse("leaves:balances-right", args=[self.sara.pk]),
                                    {"annual_days": "30", "effective_from": "2026-09-01", "reason": "Promotion manager"})
        self.assertEqual(response.status_code, 200, response.json())
        data = response.json()
        # Les 7 mois d'avant restent à 1,5 ; les mois finis les 05/09 et 05/10 rapportent 2,5 : rien en arrière.
        self.assertEqual((data["acquired"], data["yearly_right"], data["base_right"]), (15.5, 30, 18))
        self.assertEqual(data["right_changes"][0]["reason"], "Promotion manager")
        self.assertEqual(data["years"][0]["earned"], 15.5)
        # La trace dans la fiche (onglet History, Audit log).
        line = self.sara.history.latest("created_at").changes[0]
        self.assertEqual((line["old"], line["new"]), ("18", "30 à partir du 01/09/2026 (Promotion manager)"))
        # Les règles : un motif, pas avant l'embauche, une seule fois par date.
        right = reverse("leaves:balances-right", args=[self.sara.pk])
        self.assertEqual(self.client.post(right, {"annual_days": "20", "effective_from": "2026-10-01", "reason": " "}).status_code, 400)
        self.assertIn("avant l'embauche", self.client.post(right, {"annual_days": "20", "effective_from": "2025-01-01", "reason": "x"}).json()["detail"])
        self.assertIn("déjà un changement", self.client.post(right, {"annual_days": "20", "effective_from": "2026-09-01", "reason": "x"}).json()["detail"])
        # Jamais son propre droit (comme valider sa propre demande) ; un collaborateur d'un autre pôle : 404.
        self.assertEqual(self.client.post(reverse("leaves:balances-right", args=[self.nadia.pk]),
                                          {"annual_days": "30", "effective_from": "2026-09-01", "reason": "x"}).status_code, 403)
        self.assertEqual(self.client.get(reverse("leaves:balances-detail", args=[self.salma.pk])).status_code, 404)
        # La fiche ne change plus le droit (sinon : recompté jusqu'à l'embauche)...
        fiche = reverse("employees:employee-detail", args=[self.sara.pk])
        patch = self.client.patch(fiche, {"annual_leave_days": "25"}, format="json")
        self.assertIn("Leave balances", patch.json()["annual_leave_days"][0])
        # ... mais elle montre le droit ACTUEL (30 depuis le 01/09), et un changement prévu.
        self.client.post(right, {"annual_days": "32", "effective_from": "2027-01-01", "reason": "Ancienneté contrat"})
        current = self.client.get(fiche).json()["current_annual_right"]
        self.assertEqual(current, {"days": 30.0, "since": "2026-09-01", "planned": {"days": 32.0, "from": "2027-01-01"}})

    @mock.patch("django.utils.timezone.localdate", frozen_localdate)  # "aujourd'hui" = 02/11/2026
    def test_hr_corrections_go_into_the_year_of_their_date(self):
        # P1 step 3 : Omar, embauché le 06/01/2025 (18 j) : 2025 = 11 mois = 16,5 j ; 2026 = 10 mois = 15 j.
        omar = self.make_employee("omar.old", "AA100020", hire_date=datetime.date(2025, 1, 6))
        self.as_role(self.nadia, User.Role.HR)
        detail = reverse("leaves:balances-detail", args=[omar.pk])
        before = self.client.get(detail).json()
        self.assertEqual((before["available"], before["expiring"]["days"]), (31.5, 16.5))  # tout 2025 perdu au 31/12
        # Les congés 2025 pris AVANT l'application (Excel RH) : -10 j au 31/12/2025, dans la tirelire 2025.
        adjust = reverse("leaves:balances-adjustment", args=[omar.pk])
        data = self.client.post(adjust, {"days": "-10", "date": "2025-12-31", "reason": "Congés 2025 (Excel RH)"}).json()
        self.assertEqual((data["available"], data["adjusted"], data["acquired"]), (21.5, -10, 31.5))
        self.assertEqual(data["expiring"]["days"], 6.5)  # 16,5 - 10 : seulement 6,5 perdus au 31/12 (pas 16,5)
        self.assertEqual((data["years"][0]["year"], data["years"][0]["used"]), (2025, 10))
        # Un jour rendu (2 samedis d'inventaire) : +1 dans la tirelire 2026.
        data = self.client.post(adjust, {"days": "1", "date": "2026-10-15", "reason": "Samedis d'inventaire"}).json()
        self.assertEqual((data["available"], data["years"][1]["added"]), (22.5, 1))
        self.assertEqual([a["days"] for a in data["adjustments"]], [-10, 1])
        # La trace dans la fiche.
        self.assertEqual(omar.history.latest("created_at").changes[0]["new"], "+1 j au 15/10/2026 (Samedis d'inventaire)")
        # Les règles : jamais 0, pas dans le futur, pas avant l'embauche, un motif.
        for wrong in ({"days": "0", "date": "2026-10-01", "reason": "x"}, {"days": "1", "date": "2026-12-01", "reason": "x"},
                      {"days": "1", "date": "2024-12-01", "reason": "x"}, {"days": "1", "date": "2026-10-01", "reason": ""}):
            self.assertEqual(self.client.post(adjust, wrong).status_code, 400, wrong)
        # Un collaborateur : non ; jamais son propre solde.
        self.assertEqual(self.client.post(reverse("leaves:balances-adjustment", args=[self.nadia.pk]),
                                          {"days": "5", "date": "2026-10-01", "reason": "x"}).status_code, 403)

    def test_hr_records_a_leave_for_an_employee(self):
        # P1 step 4b : Sara était malade le mardi 20/10 (13 jours avant "aujourd'hui") et n'a pas pu le demander.
        sick = LeaveType.objects.get(name="Congé maladie")
        record = reverse("leaves:balances-leave", args=[self.sara.pk])
        self.as_role(self.sara, User.Role.COLLABORATOR)
        self.assertEqual(self.client.post(record, {"leave_type": sick.pk, "start_date": "2026-10-20", "end_date": "2026-10-20"}).status_code, 403)
        self.as_role(self.nadia, User.Role.HR)
        response = self.client.post(record, {"leave_type": sick.pk, "start_date": "2026-10-20", "end_date": "2026-10-20",
                                             "reason": "Certificat reçu"})
        self.assertEqual(response.status_code, 200, response.json())
        leave = LeaveRequest.objects.get(employee=self.sara, leave_type=sick)
        # Déjà acceptée, une seule étape validée par Nadia, avec la trace ; personne n'est sonné pour valider.
        self.assertEqual((leave.request.status, leave.recorded_by, leave.days), ("APPROVED", self.nadia.user, 1))
        step = leave.request.steps.get()
        self.assertEqual((step.status, step.decided_by, step.comment), ("APPROVED", self.nadia.user, "Enregistré par les RH : Certificat reçu"))
        self.assertTrue(Notification.objects.filter(recipient=self.sara.user, kind="APPROVED", request=leave.request).exists())
        self.assertFalse(Notification.objects.filter(kind="TO_VALIDATE", request=leave.request).exists())
        recorded = next(item for item in response.json()["leaves"] if item["id"] == leave.pk)
        self.assertEqual(recorded["recorded_by"], "nadia.rh")
        # Les autres règles restent : pas avant l'embauche (05/01/2026), pas sur un congé déjà là.
        before_hire = self.client.post(record, {"leave_type": sick.pk, "start_date": "2025-12-30", "end_date": "2025-12-31"})
        self.assertIn("avant l'embauche", before_hire.json()["detail"])
        overlap = self.client.post(record, {"leave_type": sick.pk, "start_date": "2026-11-24", "end_date": "2026-11-24"})
        self.assertIn("déjà un congé", overlap.json()["detail"])

    def test_cancel_an_approved_leave_before_it_starts(self):
        # P1 step 5 ("aujourd'hui" = 02/11/2026). Le congé de Sara du 23 au 27/11, accepté par Youssef.
        leave = LeaveRequest.objects.get(employee=self.sara, start_date=datetime.date(2026, 11, 23))
        engine.approve(leave.request.steps.get(status="PENDING"), self.youssef.user)
        cancel = reverse("leaves:mine-cancel", args=[leave.pk])
        # Un autre collaborateur : ce n'est pas SON congé (404).
        self.as_role(self.youssef, User.Role.COLLABORATOR)
        self.assertEqual(self.client.post(cancel, {"reason": "x"}).status_code, 404)
        # Sara : un motif est obligatoire, puis le congé est annulé et ses 5 jours reviennent.
        self.as_role(self.sara, User.Role.COLLABORATOR)
        self.assertIn("motif est obligatoire", self.client.post(cancel, {"reason": " "}).json()["detail"])
        response = self.client.post(cancel, {"reason": "Projet urgent, je reporte"})
        self.assertEqual((response.status_code, response.json()["status"]), (200, "CANCELLED"))
        self.assertEqual(balance(self.sara)["taken"], 0)
        # Youssef (qui l'avait validé) est prévenu ; l'historique dit qui a annulé et pourquoi.
        bell = Notification.objects.get(recipient=self.youssef.user, kind="CANCELLED")
        self.assertIn("Projet urgent", bell_message(bell))
        history = self.client.get(reverse("workflows:history-detail", args=[leave.request_id])).json()
        self.assertEqual((history["cancelled_by"], history["cancel_reason"]), ("sara.collab", "Projet urgent, je reporte"))
        # Un congé qui a déjà commencé (aujourd'hui) : non. Les RH peuvent annuler un congé à venir.
        today = request_leave(self.sara, self.annual, datetime.date(2026, 11, 2), datetime.date(2026, 11, 2))
        engine.approve(today.request.steps.get(status="PENDING"), self.youssef.user)
        self.assertIn("déjà commencé", self.client.post(reverse("leaves:mine-cancel", args=[today.pk]), {"reason": "x"}).json()["detail"])
        later = request_leave(self.sara, self.annual, datetime.date(2026, 11, 30), datetime.date(2026, 11, 30))
        engine.approve(later.request.steps.get(status="PENDING"), self.youssef.user)
        self.as_role(self.nadia, User.Role.HR)
        response = self.client.post(reverse("leaves:balances-cancel-leave", args=[self.sara.pk]), {"leave": later.pk, "reason": "Erreur de saisie"})
        self.assertEqual(response.status_code, 200, response.json())
        later.request.refresh_from_db()
        self.assertEqual((later.request.status, later.request.cancelled_by), ("CANCELLED", self.nadia.user))
        self.assertTrue(Notification.objects.filter(recipient=self.sara.user, kind="CANCELLED", request=later.request).exists())

    def test_admin_rh_sees_both_poles_and_the_period_filters(self):
        self.as_role(self.nadia, User.Role.HR_ADMIN)
        self.assertEqual(len(self.absences().json()), 2)
        self.assertEqual(len(self.absences(date_from="2026-11-20").json()), 1)  # seulement Sara (23 -> 27)

    def test_hr_can_also_see_refused_and_cancelled_leaves(self):
        self.as_role(self.nadia, User.Role.HR)
        rows = self.absences(status="all").json()
        self.assertEqual(sorted(row["status"] for row in rows), ["CANCELLED", "IN_PROGRESS"])  # Sara : en cours + annulé
        # Les chiffres restent ceux des absences : l'annulé ne compte pas.
        summary = self.client.get(url("absence-summary"), {"date_from": "2026-11-01", "date_to": "2026-11-30", "status": "all"})
        self.assertEqual(summary.json()["pending_days"], 5)

    def test_the_numbers_of_the_month(self):
        # Youssef : du mercredi 28/10 au jeudi 05/11. En novembre, seulement lundi 2 -> jeudi 5 = 4 jours.
        # Il commence AVANT aujourd'hui (02/11) : comme si Admin RH autorisait 10 jours dans le passé (P1 step 4).
        self.annual.max_days_back = 10
        self.annual.save()
        request_leave(self.youssef, self.annual, datetime.date(2026, 10, 28), datetime.date(2026, 11, 5))
        self.as_role(self.nadia, User.Role.HR)  # RH de SBD : Sara et Youssef (pas Salma, de Riaya ; pas l'annulé)
        response = self.client.get(url("absence-summary"), {"date_from": "2026-11-01", "date_to": "2026-11-30"})
        self.assertEqual(response.json(), {"people": 2, "absent_today": 0, "approved_days": 0, "pending_days": 9})
        # Un collaborateur : non.
        self.as_role(self.sara, User.Role.COLLABORATOR)
        self.assertEqual(self.client.get(url("absence-summary"), {"date_from": "2026-11-01", "date_to": "2026-11-30"}).status_code, 403)

    def test_absences_are_for_hr_only_with_a_valid_period(self):
        self.as_role(self.sara, User.Role.COLLABORATOR)
        self.assertEqual(self.absences().status_code, 403)
        self.as_role(self.nadia, User.Role.HR)
        self.assertEqual(self.absences(date_to="2026-02-30").status_code, 400)
        self.assertEqual(self.absences(date_to="2026-10-01").status_code, 400)  # la fin avant le début

    def test_admin_rh_manages_the_holidays_and_the_types(self):
        holidays = reverse("leaves:list-public-holidays-list")
        self.as_role(self.nadia, User.Role.HR)
        self.assertEqual(self.client.post(holidays, {"name": "Aïd Al Fitr", "date": "2027-03-10"}).status_code, 403)
        self.as_role(self.nadia, User.Role.HR_ADMIN)
        self.assertEqual(self.client.post(holidays, {"name": "Aïd Al Fitr", "date": "2027-03-10"}).status_code, 201)
        twice = self.client.post(holidays, {"name": "Autre", "date": "2027-03-10"})
        self.assertEqual(twice.json()["non_field_errors"], ["Il y a déjà un jour férié à cette date."])
        # La page : année par année (par défaut cette année), "fixed" = l'onglet (fixes / variables).
        this_year = timezone.localdate().year
        items = self.client.get(holidays, {"all": "1"}).json()
        self.assertTrue(all(item["date"].startswith(str(this_year)) for item in items))
        fixed = [item for item in items if item["fixed"]]
        self.assertEqual(len(fixed), 11)  # Marche Verte, Fête du Trône...
        self.assertTrue(all(not item["estimated"] for item in fixed))
        self.assertIn("Aïd Al Fitr", [item["name"] for item in items if not item["fixed"]])
        self.assertIn("2027-03-10", [item["date"] for item in self.client.get(holidays, {"all": "1", "year": "2027"}).json()])
        # Une année passée : gardée (on la consulte), mais en lecture seule (l'historique des anciens congés).
        old = PublicHoliday.objects.create(name="Fête passée", date=datetime.date(this_year - 1, 6, 1))
        years = self.client.get(reverse("leaves:list-public-holidays-years")).json()
        self.assertEqual((years["years"][0], years["current"]), (this_year - 1, this_year))
        self.assertEqual(len(self.client.get(holidays, {"all": "1", "year": str(this_year - 1)}).json()), 1)
        detail = reverse("leaves:list-public-holidays-detail", args=[old.pk])
        self.assertIn("Année passée", self.client.patch(detail, {"name": "Autre"}).json()["date"][0])
        self.assertEqual(self.client.post(holidays, {"name": "Trop tard", "date": f"{this_year - 1}-06-02"}).status_code, 400)
        # Un type : décompté ou pas, le maximum légal ; jamais supprimé, seulement désactivé.
        wedding = LeaveType.objects.get(name="Congé exceptionnel - Mariage du salarié")
        response = self.client.patch(reverse("leaves:list-leave-types-detail", args=[wedding.pk]), {"max_days": "5", "is_active": False})
        self.assertEqual((response.status_code, response.json()["max_days"]), (200, "5.0"))
        self.assertEqual(self.client.delete(reverse("leaves:list-leave-types-detail", args=[wedding.pk])).status_code, 405)
