"""Adresses de l'app workflows (incluses sous /api/workflows/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from .views import ApprovalViewSet, MyRequestViewSet, PoleDirectorViewSet, RequestHistoryViewSet, WorkflowViewSet

app_name = "workflows"

router = SimpleRouter()
# Le DG de chaque pôle : poles/ -> "workflows:pole-list"
router.register("poles", PoleDirectorViewSet, basename="pole")

# Les demandes (tous les rôles) : requests/ -> mes demandes, approvals/ -> ce qui attend ma réponse.
router.register("requests", MyRequestViewSet, basename="request")
router.register("approvals", ApprovalViewSet, basename="approval")
# L'historique d'une demande, pour tous ceux qu'elle concerne : history/<id>/ -> "workflows:history-detail"
router.register("history", RequestHistoryViewSet, basename="history")

# Les circuits, directement sous /api/workflows/ :
#   ""      -> "workflows:workflow-list"    (GET)
#   "<id>/" -> "workflows:workflow-detail"  (GET / PATCH)
# Enregistré EN DERNIER : sinon "poles/" serait pris pour le circuit n° "poles".
router.register("", WorkflowViewSet, basename="workflow")

urlpatterns = router.urls
