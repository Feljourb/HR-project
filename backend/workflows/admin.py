from django.contrib import admin

from .models import Request, RequestStep, Workflow, WorkflowStep


class WorkflowStepInline(admin.TabularInline):
    # Les étapes s'éditent directement dans la page du circuit (un tableau sous le nom).
    model = WorkflowStep
    extra = 0


@admin.register(Workflow)
class WorkflowAdmin(admin.ModelAdmin):
    list_display = ["name", "circuit", "is_active"]
    list_filter = ["is_active"]
    readonly_fields = ["code"]
    inlines = [WorkflowStepInline]

    @admin.display(description="Circuit")
    def circuit(self, workflow):
        # Ex. "N+1 (Valider) -> RH du pôle (Informer)", pour lire le circuit sans ouvrir la page.
        return " -> ".join(f"{step.get_approver_display()} ({step.get_mode_display()})" for step in workflow.steps.all())

    def has_add_permission(self, request):
        # Les types de demande viennent du code (un type sans son module ne servirait à rien) :
        # ici on modifie seulement les étapes.
        return False

    def has_delete_permission(self, request, obj=None):
        # Jamais supprimé, seulement désactivé (même règle que les listes).
        return False


# --- Les demandes : en lecture seule ----------------------------------------------
# Une demande ne change QUE par le moteur (envoyer, valider...), jamais à la main :
# sinon l'historique ne dirait plus la vérité.

class RequestStepInline(admin.TabularInline):
    model = RequestStep
    extra = 0
    fields = ["order", "approver", "mode", "assignee", "director", "hr_admin_replaces", "status", "decided_by", "decided_at", "comment"]
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Request)
class RequestAdmin(admin.ModelAdmin):
    list_display = ["title", "requester", "workflow", "status", "created_at"]
    list_filter = ["status", "workflow"]
    search_fields = ["title", "requester__last_name", "requester__first_name"]
    readonly_fields = ["workflow", "requester", "title", "status", "created_at", "closed_at"]
    inlines = [RequestStepInline]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
