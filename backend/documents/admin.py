from django.contrib import admin

from employees.admin import ReferenceAdmin

from .models import DocumentRequest, DocumentSignatory, DocumentType


@admin.register(DocumentType)
class DocumentTypeAdmin(ReferenceAdmin):
    list_display = ("name", "template", "is_active")
    list_filter = ("template", "is_active")


@admin.register(DocumentSignatory)
class DocumentSignatoryAdmin(admin.ModelAdmin):
    """Qui signe les documents générés, par pôle, et comment (aussi dans la page Lists -> Documents -> Signatures)."""

    list_display = ("pole", "mode", "title", "name", "city", "updated_at")
    readonly_fields = ("updated_at", "updated_by")

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(DocumentRequest)
class DocumentRequestAdmin(admin.ModelAdmin):
    """En LECTURE SEULE (2026-11-16 : les champs ajoutés -- format, délai, original prêt / remis -- étaient modifiables
    ici) : une demande change seulement par son circuit et les boutons des RH, pour que la trace reste vraie.
    Les fichiers (PDF livré, brouillon) ne sont pas montrés : seulement par l'API, avec ses droits."""

    list_display = ("doc_type", "employee", "format", "status", "reference", "due_date", "delivered_at", "collected_at")
    list_filter = ("doc_type", "format", "request__status")
    search_fields = ("employee__last_name", "employee__first_name", "reference")
    exclude = ("file", "draft")
    list_select_related = ("request", "employee", "doc_type")

    @admin.display(description="Statut")
    def status(self, document):
        return document.request.get_status_display()  # le statut vient du moteur

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False  # la page s'ouvre en lecture seule (permission "voir")

    def has_delete_permission(self, request, obj=None):
        return False
