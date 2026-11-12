"""Ce que fait le module Documents quand le moteur dit "demande acceptée" (les RH ont validé)."""
from workflows.engine import on_approved
from workflows.models import Workflow

from .models import DocumentRequest
from .services import generate


@on_approved(Workflow.Code.ADMIN_REQUEST)
def document_approved(request):
    """Un type avec un modèle : le PDF est généré tout de suite et le collaborateur est prévenu.
    Sans modèle : rien ici, la demande attend que les RH déposent le document ("To prepare").
    Une demande sans document (les démos de `make seed-requests` / `send-request`) : acceptée normalement."""
    document = DocumentRequest.objects.filter(request=request).select_related("doc_type", "employee").first()
    if document is not None and document.doc_type.template:
        generate(document)
