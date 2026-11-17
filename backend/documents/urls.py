"""Adresses de l'app documents (incluses sous /api/documents/ dans core/urls.py)."""
from django.urls import path
from rest_framework.routers import SimpleRouter

from employees.views import make_viewset

from .models import DocumentType
from .views import (ByRequestViewSet, DocumentSettingsView, FileViewSet, HrDocumentViewSet, MyDocumentViewSet,
                    SignatoryViewSet, TypeViewSet)

app_name = "documents"

router = SimpleRouter()
# Les types dans la page "Reference lists" (Admin RH), avec les mêmes règles que les autres listes.
# (Le modèle Word / PDF d'un type se change à part : types/<id>/model/, page Réglages des documents.)
router.register("lists/types", make_viewset(DocumentType, exclude=["model_file", "model_name", "body_template"]),
                basename="list-types")
router.register("types", TypeViewSet, basename="type")
router.register("mine", MyDocumentViewSet, basename="mine")
router.register("requests", ByRequestViewSet, basename="by-request")
router.register("files", FileViewSet, basename="file")
router.register("hr", HrDocumentViewSet, basename="hr")
router.register("signatories", SignatoryViewSet, basename="signatory")  # Admin RH : qui signe, et comment

urlpatterns = [
    path("settings/", DocumentSettingsView.as_view(), name="settings"),  # Admin RH : formats proposés, managers
] + router.urls
