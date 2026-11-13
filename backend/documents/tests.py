"""Tests des documents administratifs : demander, valider (RH), générer, déposer, télécharger, et les droits."""
import datetime
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Notification
from employees.notifications import link, message
from workflows import engine
from workflows.models import Request
from workflows.test_engine import EngineTestCase

from .models import DocumentRequest, DocumentType
from .services import add_working_days, request_document, upload

User = get_user_model()
MEDIA = tempfile.mkdtemp()  # les PDF des tests vont ici (effacé à la fin), pas dans media/


def pdf(name="attestation-salaire.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 test", content_type="application/pdf")


@override_settings(MEDIA_ROOT=MEDIA)
class DocumentTestCase(EngineTestCase):
    """Sara (SBD) demande ; Nadia et Hind sont RH de SBD (le circuit : RH du pôle valide)."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.work = DocumentType.objects.get(name="Attestation de travail")   # générée par l'application
        self.salary = DocumentType.objects.get(name="Attestation de salaire")  # préparée par les RH

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
        # Youssef (son N+1, pas RH) ne peut pas demander pour elle.
        with self.assertRaises(PermissionDenied):
            request_document(self.sara, self.work, by=self.youssef.user)

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


class SignatoryTests(DocumentTestCase):
    """Admin RH règle qui signe et comment (à la main, ou signature + cachet posés par l'application)."""

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
        self.assertEqual((response.json()["state"], response.json()["automatic"]), ("IN_PROGRESS", True))
        document = self.approve(DocumentRequest.objects.get(pk=response.json()["id"]))
        mine = self.client.get(reverse("documents:mine-list")).json()
        self.assertEqual((mine[0]["state"], mine[0]["has_file"]), ("READY", True))
        file_url = reverse("documents:file-detail", args=[document.request_id])
        self.assertEqual(self.client.get(file_url).status_code, 200)
        # Youssef (son N+1, pas RH) : 404, comme si le document n'existait pas.
        self.login(self.youssef)
        self.assertEqual(self.client.get(file_url).status_code, 404)
        # Nadia (RH du pôle) : oui.
        self.login(self.nadia)
        self.assertEqual(self.client.get(file_url).status_code, 200)

    def test_the_document_of_a_request(self):
        # L'historique de la demande (et Team approvals) savent où en est le document, et qui peut le déposer.
        document = self.approve(request_document(self.sara, self.salary))
        url = reverse("documents:by-request-detail", args=[document.request_id])
        self.login(self.nadia)
        data = self.client.get(url).json()
        self.assertEqual((data["state"], data["can_upload"], data["due_date"] is not None), ("TO_PREPARE", True, True))
        self.login(self.sara)
        self.assertFalse(self.client.get(url).json()["can_upload"])  # Sara attend, elle ne dépose pas
        self.login(self.youssef)
        self.assertEqual(self.client.get(url).status_code, 404)    # son N+1 : rien à voir

    def test_hr_list_and_upload(self):
        document = self.approve(request_document(self.sara, self.salary))
        self.login(self.nadia)
        to_prepare = self.client.get(reverse("documents:hr-list"), {"status": "to_prepare"}).json()
        self.assertEqual([item["request"] for item in to_prepare], [document.request_id])
        response = self.client.post(reverse("documents:hr-upload", args=[document.request_id]), {"file": pdf()}, format="multipart")
        self.assertEqual((response.status_code, response.json()["state"]), (200, "READY"))
        self.assertEqual(self.client.get(reverse("documents:hr-list"), {"status": "to_prepare"}).json(), [])
        # Un collaborateur n'a pas la page RH.
        self.login(self.sara)
        self.assertEqual(self.client.get(reverse("documents:hr-list")).status_code, 403)
