"""Adresses de l'app expenses (incluses sous /api/expenses/ dans core/urls.py)."""
from django.urls import path
from rest_framework.routers import SimpleRouter

from employees.views import make_viewset

from .models import Currency, ExpenseCategory
from .views import (CategoryViewSet, ClaimViewSet, CurrencyViewSet, ExpenseSettingsView, HrClaimViewSet, LineViewSet, MyClaimViewSet,
                    ReceiptViewSet, ScaleViewSet)

app_name = "expenses"

router = SimpleRouter()
# Les catégories dans la page "Reference lists" (Admin RH), avec les mêmes règles que les autres listes.
router.register("lists/categories", make_viewset(ExpenseCategory), basename="list-categories")
router.register("lists/currencies", make_viewset(Currency), basename="list-currencies")  # Admin RH : taux, automatique
router.register("categories", CategoryViewSet, basename="category")
router.register("currencies", CurrencyViewSet, basename="currency")
router.register("scales", ScaleViewSet, basename="scale")
router.register("mine", MyClaimViewSet, basename="mine")
router.register("claims", ClaimViewSet, basename="claim")
router.register("receipts", ReceiptViewSet, basename="receipt")
router.register("hr", HrClaimViewSet, basename="hr")
router.register("lines", LineViewSet, basename="line")  # lines/<id>/correct/ : un valideur diminue un montant

urlpatterns = [
    path("settings/", ExpenseSettingsView.as_view(), name="settings"),  # Admin RH : qui peut corriger un montant
] + router.urls
