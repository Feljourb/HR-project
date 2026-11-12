from django.contrib import admin

from employees.admin import ReferenceAdmin

from .models import DocumentRequest, DocumentSignatory, DocumentType


@admin.register(DocumentType)
class DocumentTypeAdmin(ReferenceAdmin):
    list_display = ("name", "template", "is_active")
    list_filter = ("template", "is_active")


@admin.register(DocumentSignatory)
class DocumentSignatoryAdmin(admin.ModelAdmin):
    """Qui signe les documents générés, par pôle (à remplir avec les RH)."""

    list_display = ("pole", "title", "name", "city")

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(DocumentRequest)
class DocumentRequestAdmin(admin.ModelAdmin):
    """En lecture seule : une demande change seulement par son circuit et le dépôt des RH."""

    list_display = ("doc_type", "employee", "status", "reference", "delivered_at")
    list_filter = ("doc_type", "request__status")
    search_fields = ("employee__last_name", "employee__first_name", "reference")
    readonly_fields = ("request", "employee", "doc_type", "purpose", "reference", "file_name", "delivered_at", "delivered_by")
    exclude = ("file",)
    list_select_related = ("request", "employee", "doc_type")

    @admin.display(description="Statut")
    def status(self, document):
        return document.request.get_status_display()  # le statut vient du moteur

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
