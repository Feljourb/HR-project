"""Adresses de l'app workflows (incluses sous /api/workflows/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from .views import DirectorViewSet, PoleDirectorViewSet, WorkflowViewSet

app_name = "workflows"

router = SimpleRouter()
# Les DG et le DG de chaque pôle : directors/ -> "workflows:director-list", poles/ -> "workflows:pole-list"
router.register("directors", DirectorViewSet, basename="director")
router.register("poles", PoleDirectorViewSet, basename="pole")

# Les circuits, directement sous /api/workflows/ :
#   ""      -> "workflows:workflow-list"    (GET)
#   "<id>/" -> "workflows:workflow-detail"  (GET / PATCH)
# Enregistré APRÈS directors et poles : sinon "directors/" serait pris pour le circuit n° "directors".
router.register("", WorkflowViewSet, basename="workflow")

urlpatterns = router.urls
