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
    inlines = [WorkflowStepInline]

    @admin.display(description="Circuit")
    def circuit(self, workflow):
        # Ex. "N+1 -> RH du pôle", pour lire le circuit sans ouvrir la page.
        return " -> ".join(step.get_approver_display() for step in workflow.steps.all())

    def has_delete_permission(self, request, obj=None):
        # Jamais supprimé, seulement désactivé (même règle que les listes).
        return False
