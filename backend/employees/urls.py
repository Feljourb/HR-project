"""Adresses de l'app employees (incluses sous /api/employees/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from .views import LIST_VIEWSETS, DirectoryViewSet, EmployeeViewSet

app_name = "employees"

router = SimpleRouter()
for name, viewset in LIST_VIEWSETS.items():
    router.register(f"lists/{name}", viewset, basename=name)

# L'annuaire (tous les rôles) : directory/ -> "employees:directory-list"
router.register("directory", DirectoryViewSet, basename="directory")

# Les collaborateurs, directement sous /api/employees/ (préfixe vide) :
#   ""       -> "employees:employee-list"     (GET tableau, POST créer)
#   "me/"    -> "employees:employee-me"       (GET / PATCH mon dossier)
#   "<id>/"  -> "employees:employee-detail"   (GET / PATCH un dossier)
# Enregistré APRÈS les listes et l'annuaire, pour que "lists/..." et "directory/" soient reconnus en premier.
router.register("", EmployeeViewSet, basename="employee")

urlpatterns = router.urls
