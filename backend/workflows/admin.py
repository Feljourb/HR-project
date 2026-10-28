from django.contrib import admin

from .models import Workflow, WorkflowStep


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
