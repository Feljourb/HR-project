"""Adresses de l'app expenses (incluses sous /api/expenses/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from employees.views import make_viewset

from .models import ExpenseCategory
from .views import CategoryViewSet, ClaimViewSet, HrClaimViewSet, LineViewSet, MyClaimViewSet, ScaleViewSet

app_name = "expenses"

router = SimpleRouter()
# Les catégories dans la page "Reference lists" (Admin RH), avec les mêmes règles que les autres listes.
router.register("lists/categories", make_viewset(ExpenseCategory), basename="list-categories")
router.register("categories", CategoryViewSet, basename="category")
router.register("scales", ScaleViewSet, basename="scale")
router.register("mine", MyClaimViewSet, basename="mine")
router.register("claims", ClaimViewSet, basename="claim")
router.register("lines", LineViewSet, basename="line")
router.register("hr", HrClaimViewSet, basename="hr")

urlpatterns = router.urls
