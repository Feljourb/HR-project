"""Ce que fait le module Documents quand le moteur dit "demande acceptée" (les RH ont validé)."""
from workflows.engine import on_approved
from workflows.models import Workflow

from .models import DocumentRequest
from .services import generate


@on_approved(Workflow.Code.ADMIN_REQUEST)
def document_approved(request):
    """Pour CHAQUE document de la demande (2026-11-17 : il peut y en avoir plusieurs) : un type avec un modèle -> le PDF
    est généré tout de suite et le collaborateur est prévenu ; sans modèle -> rien ici, il attend que les RH le
    préparent ("To prepare"). Une demande sans document (les démos de `make send-request`) : acceptée normalement."""
    for document in DocumentRequest.objects.filter(request=request).select_related("doc_type", "employee"):
        if document.doc_type.template:
            generate(document)
