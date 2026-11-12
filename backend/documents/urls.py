"""Adresses de l'app documents (incluses sous /api/documents/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from employees.views import make_viewset

from .models import DocumentType
from .views import FileViewSet, HrDocumentViewSet, MyDocumentViewSet, TypeViewSet

app_name = "documents"

router = SimpleRouter()
# Les types dans la page "Reference lists" (Admin RH), avec les mêmes règles que les autres listes.
router.register("lists/types", make_viewset(DocumentType), basename="list-types")
router.register("types", TypeViewSet, basename="type")
router.register("mine", MyDocumentViewSet, basename="mine")
router.register("files", FileViewSet, basename="file")
router.register("hr", HrDocumentViewSet, basename="hr")

urlpatterns = router.urls
