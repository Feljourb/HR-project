"""Adresses de l'app journeys (incluses sous /api/journeys/ dans core/urls.py)."""
from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import DepartureViewSet, JourneySettingsView, JourneyViewSet, MyTaskViewSet, TaskTemplateViewSet

app_name = "journeys"

router = SimpleRouter()
router.register("tasks", MyTaskViewSet, basename="task")              # mes tâches (tout le monde)
router.register("journeys", JourneyViewSet, basename="journey")       # les parcours que je suis (RH, manager)
router.register("departures", DepartureViewSet, basename="departure")  # les demandes de départ
router.register("templates", TaskTemplateViewSet, basename="template")  # le modèle des tâches (Admin RH)

urlpatterns = [
    path("settings/", JourneySettingsView.as_view(), name="settings"),  # Admin RH : le collaborateur peut-il demander ?
] + router.urls
