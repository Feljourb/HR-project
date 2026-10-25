"""Adresses de l'app employees (incluses sous /api/employees/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from .views import LIST_VIEWSETS, EmployeeViewSet

app_name = "employees"

# Le router crée automatiquement les adresses d'une vue, ex. pour "positions" :
#   lists/positions/       (nom "employees:positions-list")   -> GET la liste, POST ajouter
#   lists/positions/<id>/  (nom "employees:positions-detail") -> GET une valeur, PATCH modifier
router = SimpleRouter()
for name, viewset in LIST_VIEWSETS.items():
    router.register(f"lists/{name}", viewset, basename=name)

# Les collaborateurs, directement sous /api/employees/ (préfixe vide) :
#   ""       -> "employees:employee-list"     (GET tableau, POST créer)
#   "me/"    -> "employees:employee-me"       (GET / PATCH mon dossier)
#   "<id>/"  -> "employees:employee-detail"   (GET / PATCH un dossier)
# Enregistré APRÈS les listes, pour que "lists/..." soit reconnu en premier.
router.register("", EmployeeViewSet, basename="employee")

urlpatterns = router.urls
