"""Tests des documents administratifs : demander, valider (RH), générer, déposer, télécharger, et les droits."""
import datetime
import shutil
import tempfile
from io import BytesIO, StringIO

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from docx import Document as DocxDocument

from employees.models import Notification
from employees.notifications import link, message
from workflows import engine
from workflows.models import Request
from workflows.test_engine import EngineTestCase

from .models import DocumentRequest, DocumentSettings, DocumentSignatory, DocumentType
from .services import (add_working_days, mark_handed_over, mark_original_ready, next_pickup, request_document,
                       request_documents, save_text, upload)

User = get_user_model()
MEDIA = tempfile.mkdtemp()  # les PDF des tests vont ici (effacé à la fin), pas dans media/


def pdf(name="attestation-salaire.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 test", content_type="application/pdf")


def word_file(text):
    """Un vrai fichier Word (.docx) d'un paragraphe : un modèle de publipostage avec ses codes {{ ... }}."""
    model = DocxDocument()
    model.add_paragraph(text)
    out = BytesIO()
    model.save(out)
    return out.getvalue()


@override_settings(MEDIA_ROOT=MEDIA)
class DocumentTestCase(EngineTestCase):
    """Sara (SBD) demande ; Nadia et Hind sont RH de SBD (le circuit : RH du pôle valide).
    Par défaut, SBD a choisi "signature et cachet ajoutés par l'application" (auto_sign) ; sinon : "à la main"."""

    auto_sign = True

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.work = DocumentType.objects.get(name="Attestation de travail")   # générée par l'application
        self.salary = DocumentType.objects.get(name="Attestation de salaire")  # préparée par les RH
        if self.auto_sign:
            DocumentSignatory.objects.update_or_create(pole=self.sara.department.direction.entity.pole,
                                                       defaults={"mode": "IMAGE", "signature": png()})
        # Les tests "manager" d'avant le réglage (2026-11-17) : Admin RH a ouvert la demande à tous les managers
        # (le défaut est "Non" ; SettingsTests vérifie Non / managers choisis / formats).
        DocumentSettings.objects.update_or_create(pk=1, defaults={"manager_requests": "ALL"})

    def approve(self, document, by=None):
        step = document.request.steps.get(status="PENDING")
        engine.approve(step, (by or self.nadia).user)
        document.refresh_from_db()
        return document

    def ready_notices(self):
        return Notification.objects.filter(recipient=self.sara.user, kind=Notification.Kind.DOCUMENT_READY)


class FlowTests(DocumentTestCase):
    def test_a_work_certificate_is_generated_when_hr_approve(self):
        document = request_document(self.sara, self.work, "Banque")
        self.assertEqual((document.request.title, document.state), ("Attestation de travail (Banque)", "IN_PROGRESS"))
        self.assertFalse(document.file)
        document = self.approve(document)
        # Le PDF est là, avec sa référence, et Sara est prévenue (🔔 + email "Document prêt").
        self.assertEqual(document.state, "READY")
        self.assertTrue(document.reference.startswith("DOC-"))
        self.assertTrue(document.file.open("rb").read().startswith(b"%PDF"))
        self.assertIsNone(document.delivered_by)  # généré par l'application
        notice = self.ready_notices().get()
        self.assertIn(document.reference, message(notice))
        self.assertEqual(link(notice), "/documents")

    def test_a_salary_certificate_is_prepared_by_hr(self):
        document = self.approve(request_document(self.sara, self.salary))
        self.assertEqual(document.state, "TO_PREPARE")  # validée : les RH préparent
        self.assertFalse(self.ready_notices().exists())
        # Sara ne dépose pas son propre document ; un fichier qui n'est pas un PDF est refusé.
        with self.assertRaises(PermissionDenied):
            upload(document, self.sara.user, pdf())
        with self.assertRaisesMessage(ValidationError, "Seulement un PDF"):
            upload(document, self.nadia.user, SimpleUploadedFile("photo.jpg", b"x"))
        document = upload(document, self.nadia.user, pdf())
        self.assertEqual((document.state, document.delivered_by), ("READY", self.nadia.user))
        self.assertTrue(self.ready_notices().exists())
        # Livré : il ne se remplace plus (la trace ; une correction = une nouvelle demande).
        with self.assertRaisesMessage(ValidationError, "ne se remplace pas"):
            upload(document, self.hind.user, pdf("corrige.pdf"))

    def test_rules(self):
        request_document(self.sara, self.salary)
        # Une seule demande en cours par type ; un autre type, oui.
        with self.assertRaisesMessage(ValidationError, "déjà en cours"):
            request_document(self.sara, self.salary)
        request_document(self.sara, self.work)
        # Un type désactivé par Admin RH ne se demande plus.
        DocumentType.objects.filter(pk=self.salary.pk).update(is_active=False)
        self.salary.refresh_from_db()
        DocumentRequest.objects.all().delete()
        with self.assertRaisesMessage(ValidationError, "plus proposé"):
            request_document(self.sara, self.salary)

    def test_the_employee_chooses_the_format(self):
        # PDF par défaut ; "original" : le RH le voit dès le titre (Team approvals, cloche).
        self.assertEqual(request_document(self.sara, self.work).format, "PDF")
        document = request_document(self.sara, self.salary, "Visa", format="BOTH")
        self.assertEqual((document.format, document.request.title), ("BOTH", "Attestation de salaire (Visa) · PDF + original"))
        with self.assertRaisesMessage(ValidationError, "format"):
            request_document(self.sara, DocumentType.objects.get(name="Attestation de congé"), format="FAX")

    def test_the_paper_original(self):
        # "Original" seul : un brouillon sans signature, que les RH impriment ; Sara n'a pas "Document prêt".
        document = self.approve(request_document(self.sara, self.work, "Consulat", format="ORIGINAL"))
        self.assertTrue(document.draft)
        self.assertFalse(document.file)
        self.assertFalse(self.ready_notices().exists())
        self.assertEqual((document.state, document.original_state), ("TO_PREPARE", "TO_SIGN"))
        # Sara ne marque rien elle-même ; "remis" avant "prêt" : refusé.
        with self.assertRaises(PermissionDenied):
            mark_original_ready(document, self.sara.user)
        with self.assertRaisesMessage(ValidationError, "d'abord"):
            mark_handed_over(document, self.nadia.user)
        # Nadia l'a signé et tamponné : Sara est prévenue ("Original prêt au bureau RH").
        document = mark_original_ready(document, self.nadia.user)
        self.assertEqual((document.state, document.original_state), ("PICKUP", "PICKUP"))
        notice = Notification.objects.get(recipient=self.sara.user, kind=Notification.Kind.ORIGINAL_READY)
        self.assertIn("bureau RH", message(notice))
        # (Demandé par Sara elle-même : son manager n'est pas prévenu.)
        self.assertFalse(Notification.objects.filter(recipient=self.youssef.user, kind=Notification.Kind.ORIGINAL_READY).exists())
        # Sara est venue : remis (quand, par qui).
        document = mark_handed_over(document, self.hind.user)
        self.assertEqual((document.state, document.original_state, document.collected_by), ("READY", "COLLECTED", self.hind.user))
        self.assertEqual(document.handed_to, self.sara)  # à elle-même : pas de notification "remis à votre manager"
        self.assertFalse(Notification.objects.filter(kind=Notification.Kind.ORIGINAL_HANDED).exists())
        # Une demande en PDF seulement : pas d'original à préparer.
        pdf_only = self.approve(request_document(self.sara, self.work))
        with self.assertRaisesMessage(ValidationError, "pas demandé"):
            mark_original_ready(pdf_only, self.nadia.user)

    def test_both_gives_the_pdf_at_once_then_the_original(self):
        document = self.approve(request_document(self.sara, self.work, format="BOTH"))
        self.assertTrue(self.ready_notices().exists())  # le PDF tout de suite
        self.assertEqual((document.state, document.original_state), ("TO_PREPARE", "TO_SIGN"))  # reste l'original

    def test_pickup_days_and_needed_by(self):
        # 2026-11-17, comme l'outil des RH : retrait mercredi et vendredi après-midi.
        tz = timezone.get_current_timezone()
        at = lambda day, hour, month=12: datetime.datetime(2026, month, day, hour, tzinfo=tz)  # noqa: E731 (07/12/2026 = lundi)
        days = [2, 4]
        self.assertEqual(next_pickup(at(7, 9), days), datetime.date(2026, 12, 9))     # lundi -> mercredi
        self.assertEqual(next_pickup(at(9, 10), days), datetime.date(2026, 12, 9))    # mercredi matin -> le jour même
        self.assertEqual(next_pickup(at(9, 15), days), datetime.date(2026, 12, 11))   # mercredi après-midi -> vendredi
        self.assertEqual(next_pickup(at(11, 15), days), datetime.date(2026, 12, 16))  # vendredi après-midi -> mercredi
        # Mercredi 18/11/2026 = Fête de l'Indépendance (férié) : le bureau RH est fermé -> vendredi 20.
        self.assertEqual(next_pickup(at(16, 9, month=11), days), datetime.date(2026, 11, 20))
        self.assertIsNone(next_pickup(at(7, 9), []))
        # Un original : prévu le prochain jour de retrait ; la date souhaitée est gardée, jamais dans le passé.
        tomorrow = timezone.localdate() + datetime.timedelta(days=1)
        document = request_document(self.sara, self.salary, format="ORIGINAL", needed_by=tomorrow)
        self.assertEqual(document.due_date, next_pickup(timezone.now(), days))
        self.assertEqual(document.needed_by, tomorrow)
        with self.assertRaisesMessage(ValidationError, "passé"):
            request_document(self.sara, self.work, needed_by=timezone.localdate() - datetime.timedelta(days=1))

    def test_several_documents_in_one_request(self):
        # 2026-11-17 (comme l'outil actuel des RH) : Sara coche 2 documents -> UNE demande, UNE validation des RH.
        work, salary = request_documents(self.sara, [self.work, self.salary], "Banque")
        self.assertEqual(work.request_id, salary.request_id)
        self.assertEqual(work.request.title, "Attestation de travail + Attestation de salaire (Banque)")
        self.assertEqual(work.request.steps.count(), 1)
        self.approve(work)
        work.refresh_from_db()
        salary.refresh_from_db()
        # Puis chacun son chemin : l'attestation de travail générée tout de suite, celle de salaire préparée par les RH.
        self.assertEqual((work.state, salary.state), ("READY", "TO_PREPARE"))
        notice = self.ready_notices().get()
        self.assertIn("Attestation de travail", message(notice))
        upload(salary, self.nadia.user, pdf())
        salary.refresh_from_db()
        self.assertEqual(salary.state, "READY")
        # Le 2e "Document prêt" parle de l'attestation de salaire (pas de la première).
        latest = self.ready_notices().order_by("-created_at", "-id").first()
        self.assertIn("Attestation de salaire", message(latest))
        # Déjà en cours pour un type : refusé (avec son nom), rien n'est créé.
        request_document(self.sara, self.salary)
        with self.assertRaisesMessage(ValidationError, "Attestation de salaire"):
            request_documents(self.sara, [self.work, self.salary])
        with self.assertRaises(ValidationError):
            request_documents(self.sara, [])

    def test_admin_rh_settings_managers_and_formats(self):
        # 2026-11-17 : Admin RH choisit si les managers demandent pour leur équipe (défaut : non) et quels formats.
        options = DocumentSettings.load()
        options.manager_requests = "OFF"
        options.save()
        with self.assertRaises(PermissionDenied):
            request_document(self.sara, self.work, by=self.youssef.user)
        # Seulement les managers choisis (ex. les chefs de l'usine) : Youssef n'y est pas, puis il y est.
        options.manager_requests = "CHOSEN"
        options.save()
        with self.assertRaises(PermissionDenied):
            request_document(self.sara, self.work, by=self.youssef.user)
        options.chosen_managers.add(self.youssef)
        request_document(self.sara, self.work, by=self.youssef.user, format="ORIGINAL")
        # Les formats : seulement le PDF proposé -> l'original est refusé au collaborateur, pas aux RH.
        options.offer_original = options.offer_both = False
        options.save()
        self.assertEqual(options.formats(), ["PDF"])
        with self.assertRaises(ValidationError):
            request_document(self.sara, self.salary, format="ORIGINAL")
        request_document(self.sara, self.salary, by=self.nadia.user, format="ORIGINAL")  # les RH : tous les formats

    def test_the_manager_requests_for_his_team(self):
        # Youssef (N+1 de Sara) demande l'original de son attestation de travail : les RH valident quand même.
        document = request_document(self.sara, self.work, "Banque", by=self.youssef.user, format="ORIGINAL")
        self.assertEqual((document.state, document.requested_by, document.employee), ("IN_PROGRESS", self.youssef.user, self.sara))
        # Sara est prévenue qu'une demande a été faite en son nom.
        notice = Notification.objects.get(recipient=self.sara.user, kind=Notification.Kind.REQUESTED_FOR)
        self.assertIn("a demandé pour vous : Attestation de travail", message(notice))
        # Pas un type choisi par Admin RH (le salaire ne le regarde pas) ; pas quelqu'un hors de son équipe.
        # L'original prêt : Sara ET Youssef sont prévenus (il prévient l'ouvrier de passer au bureau RH).
        document = mark_original_ready(self.approve(document), self.nadia.user)
        for_youssef = Notification.objects.get(recipient=self.youssef.user, kind=Notification.Kind.ORIGINAL_READY)
        self.assertIn("Prévenez-le", message(for_youssef))
        # Youssef vient le chercher pour elle : remis à son manager (la trace), et Sara est prévenue.
        document = mark_handed_over(document, self.nadia.user, to_manager=True)
        self.assertEqual((document.handed_to, document.state), (self.youssef, "READY"))
        handed = Notification.objects.get(recipient=self.sara.user, kind=Notification.Kind.ORIGINAL_HANDED)
        self.assertIn("remis à votre manager", message(handed))
        with self.assertRaisesMessage(ValidationError, "ne se demande pas par le manager"):
            request_document(self.sara, self.salary, by=self.youssef.user)
        with self.assertRaises(PermissionDenied):
            request_document(self.nadia, self.work, by=self.youssef.user)

    def test_delivery_date_in_working_days(self):
        # Un jeudi + 2 jours ouvrés = le lundi (pas le samedi) ; un document généré : le jour même.
        thursday = datetime.date(2026, 11, 12)
        self.assertEqual(add_working_days(thursday, 2), datetime.date(2026, 11, 16))
        self.assertEqual(add_working_days(thursday, 0), thursday)
        document = request_document(self.sara, self.salary)
        self.assertEqual(document.due_date, add_working_days(timezone.localdate(), 2))
        self.assertFalse(document.late)
        DocumentRequest.objects.filter(pk=document.pk).update(due_date=timezone.localdate() - datetime.timedelta(days=1))
        document.refresh_from_db()
        self.assertTrue(document.late)  # le délai est passé : en rouge chez les RH

    def test_hr_requests_for_an_employee(self):
        # Nadia (RH du pôle) demande POUR Sara : acceptée tout de suite, la trace dit qui l'a demandée.
        document = request_document(self.sara, self.work, "Banque", by=self.nadia.user)
        self.assertEqual((document.state, document.requested_by, document.employee), ("READY", self.nadia.user, self.sara))
        self.assertIn("Demandé par les RH", document.request.steps.get().comment)
        self.assertTrue(self.ready_notices().exists())  # Sara est prévenue
        # Un document préparé par les RH : à préparer tout de suite.
        self.assertEqual(request_document(self.sara, self.salary, by=self.nadia.user).state, "TO_PREPARE")
        # Youssef (son N+1, pas RH) peut demander pour elle (2026-11-16), mais SANS l'accepter : les RH valident.
        DocumentRequest.objects.filter(doc_type=self.work).delete()
        self.assertEqual(request_document(self.sara, self.work, by=self.youssef.user).state, "IN_PROGRESS")

    def test_refused_and_upload_before_approval(self):
        document = request_document(self.sara, self.salary)
        with self.assertRaisesMessage(ValidationError, "après la validation"):
            upload(document, self.nadia.user, pdf())
        engine.reject(document.request.steps.get(status="PENDING"), self.nadia.user, "Demande incomplète")
        document.refresh_from_db()
        self.assertEqual(document.state, Request.Status.REJECTED)


def png(name="signature.png"):
    """Une petite image PNG valide (comme un scan de signature)."""
    from io import BytesIO

    from PIL import Image
    buffer = BytesIO()
    Image.new("RGBA", (200, 80), (25, 38, 70, 255)).save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


class HandSignedTests(DocumentTestCase):
    """Step D : le pôle a choisi "à signer à la main" : l'application ne livre JAMAIS un document non signé."""

    auto_sign = False

    def test_the_generated_pdf_is_a_draft_for_hr_only(self):
        document = self.approve(request_document(self.sara, self.work))
        # Un brouillon pour les RH ; rien pour Sara (pas de fichier, pas de "Document prêt").
        self.assertEqual((bool(document.draft), bool(document.file), document.state), (True, False, "TO_PREPARE"))
        self.assertFalse(self.ready_notices().exists())
        client = APIClient()
        url = reverse("documents:file-detail", args=[document.pk]) + "?draft=1"
        for employee, status_code in ((self.sara, 404), (self.nadia, 200)):
            employee.user.must_change_password = False
            employee.user.save()
            client.force_authenticate(employee.user)
            self.assertEqual(client.get(url).status_code, status_code)
        data = client.get(reverse("documents:by-request-detail", args=[document.request_id])).json()[0]
        self.assertEqual((data["can_print"], data["can_upload"]), (True, True))  # Nadia : imprimer, puis déposer
        # Avant d'imprimer, Nadia peut modifier le texte : le brouillon est refait (toujours rien pour Sara).
        draft_before = document.draft.name
        document = save_text(document, self.nadia.user, "Texte corrigé par les RH.")
        self.assertNotEqual(document.draft.name, draft_before)
        self.assertFalse(document.file)
        # Nadia l'a signé, tamponné, scanné : Sara le reçoit.
        document = upload(document, self.nadia.user, pdf())
        self.assertEqual(document.state, "READY")
        self.assertTrue(self.ready_notices().exists())


class SignatoryTests(DocumentTestCase):
    """Admin RH règle qui signe et comment (à la main, ou signature + cachet posés par l'application)."""

    auto_sign = False

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.admin = User.objects.create_user("admin.rh", role=User.Role.HR_ADMIN, must_change_password=False)
        self.client.force_authenticate(self.admin)
        self.sbd = next(item for item in self.client.get(reverse("documents:signatory-list")).json() if item["pole"] == "SBD")
        self.url = reverse("documents:signatory-detail", args=[self.sbd["id"]])

    def test_images_mode_puts_the_signature_and_stamp_on_the_pdf(self):
        self.assertEqual(self.sbd["mode"], "HAND")  # au départ : à signer à la main
        # Le mode "images" sans la signature : refusé tout de suite.
        response = self.client.patch(self.url, {"mode": "IMAGE"}, format="multipart")
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(self.url, {"mode": "IMAGE", "name": "Karima Idrissi", "signature": png(),
                                                "stamp": png("cachet.png")}, format="multipart")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual((response.json()["has_signature"], response.json()["has_stamp"]), (True, True))
        # L'attestation générée après la validation porte les deux images.
        document = self.approve(request_document(self.sara, self.work))
        content = document.file.open("rb").read()
        self.assertEqual(content.count(b"/Subtype /Image"), 2)
        # L'exemple (aperçu) aussi ; une image qui n'est pas PNG / JPG : refusée.
        preview = self.client.get(reverse("documents:signatory-preview", args=[self.sbd["id"]]))
        self.assertEqual((preview.status_code, preview["Content-Type"]), (200, "application/pdf"))
        bad = self.client.patch(self.url, {"stamp": SimpleUploadedFile("cachet.gif", b"GIF89a")}, format="multipart")
        self.assertEqual(bad.status_code, 400)

    def test_only_admin_rh(self):
        self.nadia.user.must_change_password = False
        self.nadia.user.save()
        self.client.force_authenticate(self.nadia.user)  # RH du pôle, pas Admin RH
        self.assertEqual(self.client.get(reverse("documents:signatory-list")).status_code, 403)


@override_settings(DEBUG=True, MEDIA_ROOT=MEDIA)
class DemoAndAdminTests(TestCase):
    def test_make_seed_requests_sends_real_document_requests(self):
        # make seed (les comptes de test) puis make seed-requests : les 2 attestations sont de VRAIES demandes du module.
        call_command("seed_test_fiches", stdout=StringIO())
        call_command("seed_requests", stdout=StringIO())
        self.assertEqual(sorted(DocumentRequest.objects.values_list("doc_type__name", flat=True)),
                         ["Attestation de salaire", "Attestation de travail"])
        call_command("seed_requests", stdout=StringIO())  # relancé : rien en double
        self.assertEqual(DocumentRequest.objects.count(), 2)

    def test_a_request_is_read_only_in_the_admin(self):
        call_command("seed_test_fiches", stdout=StringIO())
        call_command("seed_requests", stdout=StringIO())
        it = User.objects.create_superuser("it.admin", password="x")
        self.client.force_login(it)
        document = DocumentRequest.objects.first()
        url = reverse("admin:documents_documentrequest_change", args=[document.pk])
        self.assertEqual(self.client.get(url).status_code, 200)  # on la voit...
        with self.assertLogs("django.request", level="WARNING"):  # Django note le refus (403) dans ses logs
            self.assertEqual(self.client.post(url, {"purpose": "changé", "format": "BOTH"}).status_code, 403)
        document.refresh_from_db()
        self.assertEqual((document.purpose, document.format), ("démo", "PDF"))  # ... sans pouvoir la changer


class ApiTests(DocumentTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def login(self, employee):
        employee.user.must_change_password = False
        employee.user.save()
        self.client.force_authenticate(employee.user)

    def test_request_download_and_privacy(self):
        self.login(self.sara)
        self.assertIn("Attestation de travail", [t["name"] for t in self.client.get(reverse("documents:type-list")).json()])
        response = self.client.post(reverse("documents:mine-list"), {"doc_type": self.work.pk, "purpose": "Visa"})
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual((response.json()[0]["state"], response.json()[0]["automatic"]), ("IN_PROGRESS", True))
        document = self.approve(DocumentRequest.objects.get(pk=response.json()[0]["id"]))
        mine = self.client.get(reverse("documents:mine-list")).json()
        self.assertEqual((mine[0]["state"], mine[0]["has_file"]), ("READY", True))
        file_url = reverse("documents:file-detail", args=[document.pk])
        self.assertEqual(self.client.get(file_url).status_code, 200)
        # Youssef (son N+1, pas RH) : 404, comme si le document n'existait pas.
        self.login(self.youssef)
        self.assertEqual(self.client.get(file_url).status_code, 404)
        # Nadia (RH du pôle) : oui.
        self.login(self.nadia)
        self.assertEqual(self.client.get(file_url).status_code, 200)

    def test_hr_download_draft_or_model(self):
        # ① "Download" (2026-11-17) : généré -> le brouillon PDF (même avant "Customize") ; préparé -> le modèle Word.
        DocumentType.objects.filter(pk=self.work.pk).update(hr_review=True)  # rien n'est fabriqué à la validation
        work = self.approve(request_document(self.sara, self.work))
        salary = self.approve(request_document(self.sara, self.salary))
        self.login(self.nadia)
        response = self.client.get(reverse("documents:hr-download", args=[work.pk]))
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/pdf"))
        self.assertEqual(self.client.get(reverse("documents:hr-download", args=[salary.pk])).status_code, 404)  # pas de modèle
        # Admin RH met le modèle Word de l'attestation de salaire (avec des codes : le publipostage) ; une RH ne peut pas.
        model_url = reverse("documents:type-model", args=[self.salary.pk])
        word = SimpleUploadedFile("Attestation salaire.docx", word_file("Attestation : {{ civilite }} {{ nom }} {{ prenom }}, CIN {{ cin }}, "
                                                                        "poste {{ poste }}. {{ code_inconnu }}Fin."))
        self.assertEqual(self.client.post(model_url, {"file": word}, format="multipart").status_code, 403)
        admin = User.objects.create_user("admin.rh2", role=User.Role.HR_ADMIN, must_change_password=False)
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.post(model_url, {"file": SimpleUploadedFile("virus.exe", b"x")}, format="multipart").status_code, 400)
        broken = SimpleUploadedFile("cassé.docx", word_file("Bonjour {{ nom"))  # un code mal fermé : refusé tout de suite
        self.assertIn("mal écrit", self.client.post(model_url, {"file": broken}, format="multipart").json()["detail"])
        self.assertIn("nom", self.client.get(reverse("documents:settings")).json()["codes"])  # l'aide des codes
        word.seek(0)
        data = self.client.post(model_url, {"file": word}, format="multipart").json()
        self.assertEqual((data["has_model"], data["model_name"]), (True, "Attestation salaire.docx"))
        self.login(self.nadia)
        self.assertEqual(self.client.get(reverse("documents:by-request-detail", args=[salary.request_id])).json()[0]["hr_download"], "model")
        model = self.client.get(reverse("documents:hr-download", args=[salary.pk]))
        self.assertEqual(model.status_code, 200)
        text = "\n".join(paragraph.text for paragraph in DocxDocument(BytesIO(model.content)).paragraphs)
        self.assertIn(f"{self.sara.last_name.upper()} {self.sara.first_name}, CIN {self.sara.cin}", text)
        self.assertIn("Fin.", text)  # un code inconnu devient vide, sans erreur
        # Le collaborateur : jamais (404, comme s'il n'existait pas).
        self.login(self.sara)
        self.assertEqual(self.client.get(model_url).status_code, 404)

    def test_api_several_documents(self):
        # Le formulaire envoie les cases cochées : une demande, deux documents (un par ligne dans les listes).
        self.login(self.sara)
        response = self.client.post(reverse("documents:mine-list"), {"doc_types": [self.work.pk, self.salary.pk]}, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual([item["doc_type"] for item in response.json()], ["Attestation de travail", "Attestation de salaire"])
        request_id = response.json()[0]["request"]
        both = self.client.get(reverse("documents:by-request-detail", args=[request_id])).json()
        self.assertEqual(len(both), 2)
        self.assertEqual(self.client.post(reverse("documents:mine-list"), {"doc_types": []}, format="json").status_code, 400)

    def test_the_document_of_a_request(self):
        # L'historique de la demande (et Team approvals) savent où en est le document, et qui peut le déposer.
        document = self.approve(request_document(self.sara, self.salary))
        url = reverse("documents:by-request-detail", args=[document.request_id])
        self.login(self.nadia)
        data = self.client.get(url).json()[0]
        self.assertEqual((data["state"], data["can_upload"], data["due_date"] is not None), ("TO_PREPARE", True, True))
        self.login(self.sara)
        self.assertFalse(self.client.get(url).json()[0]["can_upload"])  # Sara attend, elle ne dépose pas
        self.login(self.youssef)
        self.assertEqual(self.client.get(url).status_code, 404)    # son N+1 : rien à voir

    def test_the_manager_cancels_what_he_requested_by_mistake(self):
        document = request_document(self.sara, self.work, by=self.youssef.user)
        url = reverse("workflows:request-cancel", args=[document.request_id])
        self.login(self.karim)  # un autre : 404 (ce n'est ni sa demande, ni sa saisie)
        self.assertEqual(self.client.post(url).status_code, 404)
        self.login(self.youssef)
        # Au nom de Sara : le motif est obligatoire (elle le lit dans sa notification).
        self.assertEqual(self.client.post(url).status_code, 400)
        self.assertEqual(self.client.post(url, {"reason": "Erreur : mauvais collaborateur"}).status_code, 200)
        document.refresh_from_db()
        self.assertEqual(document.state, Request.Status.CANCELLED)  # pas effacée : annulée, avec la trace
        self.assertEqual(document.request.cancelled_by, self.youssef.user)
        # Sara est prévenue : c'était une demande en son nom.
        notice = Notification.objects.get(recipient=self.sara.user, kind=Notification.Kind.CANCELLED)
        self.assertIn(f"Demande annulée par {self.youssef.first_name}", message(notice))
        self.assertIn("Motif : Erreur : mauvais collaborateur", message(notice))

    def test_the_manager_sees_the_progress_never_the_document(self):
        self.login(self.youssef)
        members = self.client.get(reverse("documents:mine-team-members")).json()
        self.assertIn(self.sara.pk, [member["id"] for member in members])
        response = self.client.post(reverse("documents:mine-list"), {"doc_type": self.work.pk, "employee": self.sara.pk})
        self.assertEqual(response.status_code, 201, response.json())
        document = self.approve(DocumentRequest.objects.get(pk=response.json()[0]["id"]))  # signé par l'application
        self.assertTrue(document.file)
        mine = self.client.get(reverse("documents:mine-for-team")).json()
        self.assertEqual([(item["state"], item["can_download"]) for item in mine], [("READY", False)])
        self.assertEqual(self.client.get(reverse("documents:file-detail", args=[document.pk])).status_code, 404)
        # Il suit l'historique (il a saisi la demande), et tout le monde voit "saisie par Youssef".
        history = self.client.get(reverse("workflows:history-detail", args=[document.request_id]))
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["initiated_by_name"], f"{self.youssef.first_name} {self.youssef.last_name.title()}")
        # L'onglet "For my team" de Team approvals : les demandes qu'il a saisies.
        initiated = self.client.get(reverse("workflows:request-initiated")).json()
        self.assertEqual([item["id"] for item in initiated], [document.request_id])
        # Prévenu comme Sara (acceptée), avec un texte pour lui ("La demande de Sara ...", pas "Votre demande").
        notice = Notification.objects.get(recipient=self.youssef.user, kind=Notification.Kind.APPROVED)
        self.assertTrue(message(notice).startswith("La demande de"))
        # Sara, elle, le télécharge.
        self.login(self.sara)
        self.assertEqual(self.client.get(reverse("documents:file-detail", args=[document.pk])).status_code, 200)

    def test_hr_review_before_sending(self):
        # Step 3 : "Relecture RH avant l'envoi" sur l'attestation de travail : rien ne part à la validation.
        DocumentType.objects.filter(pk=self.work.pk).update(hr_review=True)
        document = self.approve(request_document(self.sara, self.work))
        self.assertEqual((bool(document.file), bool(document.draft), document.state), (False, False, "TO_PREPARE"))
        self.assertFalse(self.ready_notices().exists())
        self.login(self.nadia)
        text_url = reverse("documents:hr-text", args=[document.pk])
        data = self.client.get(reverse("documents:by-request-detail", args=[document.request_id])).json()[0]
        self.assertEqual((data["needs_review"], data["can_edit_text"]), (True, True))
        # Le texte de la fiche (avec le CIN), qu'elle complète ; l'aperçu, puis l'envoi.
        text = self.client.get(text_url).json()["text"]
        self.assertIn(self.sara.cin, text)
        text += "\n\nL'intéressée est affectée au site de Tanger."
        # Rien ne part avant la relecture (ni un PDF déposé à la place).
        with self.assertRaisesMessage(ValidationError, "Relisez d'abord"):
            upload(document, self.nadia.user, pdf())
        preview = self.client.post(reverse("documents:hr-preview-text", args=[document.pk]), {"text": text})
        self.assertEqual((preview.status_code, preview["Content-Type"]), (200, "application/pdf"))
        sent = self.client.post(text_url, {"text": text}).json()
        self.assertEqual((sent["state"], sent["text_reviewed_by"] is not None), ("READY", True))  # signé : livré
        document.refresh_from_db()
        self.assertIn("site de Tanger", document.body)
        self.assertTrue(self.ready_notices().exists())
        # Livré : le texte ne change plus ; un collaborateur n'a pas accès.
        self.assertEqual(self.client.post(text_url, {"text": "autre"}).status_code, 400)
        self.login(self.sara)
        self.assertEqual(self.client.post(text_url, {"text": "x"}).status_code, 403)
        # La relecture est une étape interne des RH : Sara ne la voit pas.
        mine = self.client.get(reverse("documents:by-request-detail", args=[document.request_id])).json()[0]
        self.assertEqual((mine["text_reviewed_by"], mine["body_edited_at"]), (None, None))

    def test_hr_search_and_filters(self):
        work = request_document(self.sara, self.work)
        request_document(self.sara, self.salary)
        self.login(self.nadia)
        url = reverse("documents:hr-list")

        def found(**params):
            return [item["request"] for item in self.client.get(url, params).json()]

        self.assertEqual(len(found(search=self.sara.last_name.lower())), 2)  # le nom, sans les majuscules
        self.assertEqual(found(search="personne"), [])
        self.assertEqual(found(type=self.work.pk), [work.request_id])
        today = timezone.localdate()
        self.assertEqual(len(found(**{"from": today.isoformat(), "to": today.isoformat()})), 2)
        self.assertEqual(found(**{"from": (today + datetime.timedelta(days=1)).isoformat()}), [])
        self.assertEqual(len(found(**{"from": "2026-02-31"})), 2)  # une date impossible : ignorée

    def test_hr_list_and_upload(self):
        document = self.approve(request_document(self.sara, self.salary))
        self.login(self.nadia)
        to_prepare = self.client.get(reverse("documents:hr-list"), {"status": "to_prepare"}).json()
        self.assertEqual([item["request"] for item in to_prepare], [document.request_id])
        response = self.client.post(reverse("documents:hr-upload", args=[document.pk]), {"file": pdf()}, format="multipart")
        self.assertEqual((response.status_code, response.json()["state"]), (200, "READY"))
        self.assertEqual(self.client.get(reverse("documents:hr-list"), {"status": "to_prepare"}).json(), [])
        # Un original papier : "Original ready" puis "Handed over", et le filtre "à remettre".
        original = self.approve(request_document(self.sara, self.work, format="ORIGINAL"))
        self.client.post(reverse("documents:hr-original-ready", args=[original.pk]))
        pickup = self.client.get(reverse("documents:hr-list"), {"status": "pickup"}).json()
        self.assertEqual([(item["request"], item["original_state"]) for item in pickup], [(original.request_id, "PICKUP")])
        response = self.client.post(reverse("documents:hr-handed-over", args=[original.pk]))
        self.assertEqual((response.json()["state"], response.json()["collected_by"] is not None), ("READY", True))
        # Le brouillon d'un "original seul" : pour les RH (à imprimer), pas pour Sara.
        file_url = reverse("documents:file-detail", args=[original.pk]) + "?draft=1"
        self.assertEqual(self.client.get(file_url).status_code, 200)
        # Un collaborateur n'a pas la page RH.
        self.login(self.sara)
        self.assertEqual(self.client.get(reverse("documents:hr-list")).status_code, 403)
        self.assertEqual(self.client.get(file_url).status_code, 404)
