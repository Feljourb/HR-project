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

from employees.models import Department, Employee
from workflows.test_engine import EngineTestCase

from .balance import balance
from .models import LeaveRequest, LeaveType, PublicHoliday
from .tests import frozen_localdate
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
