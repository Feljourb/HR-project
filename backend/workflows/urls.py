"""Adresses de l'app workflows (incluses sous /api/workflows/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from .views import ApprovalViewSet, DirectorViewSet, MyRequestViewSet, PoleDirectorViewSet, WorkflowViewSet

app_name = "workflows"

router = SimpleRouter()
# Les DG et le DG de chaque pôle : directors/ -> "workflows:director-list", poles/ -> "workflows:pole-list"
router.register("directors", DirectorViewSet, basename="director")
router.register("poles", PoleDirectorViewSet, basename="pole")

# Les demandes (tous les rôles) : requests/ -> mes demandes, approvals/ -> ce qui attend ma réponse.
router.register("requests", MyRequestViewSet, basename="request")
router.register("approvals", ApprovalViewSet, basename="approval")

# Les circuits, directement sous /api/workflows/ :
#   ""      -> "workflows:workflow-list"    (GET)
#   "<id>/" -> "workflows:workflow-detail"  (GET / PATCH)
# Enregistré EN DERNIER : sinon "directors/" serait pris pour le circuit n° "directors".
router.register("", WorkflowViewSet, basename="workflow")

urlpatterns = router.urls
