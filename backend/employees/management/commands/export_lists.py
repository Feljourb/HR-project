from pathlib import Path

from django.core.management.base import BaseCommand
from openpyxl import Workbook
from openpyxl.styles import Font

from employees.models import (
    Assignment, Bank, Category, ContractType, CostCenter, Department, Direction, Division,
    Entity, Grade, Pole, Position, Region, TempAgency,
)

# One sheet per list: (model, parent columns shown before "Nom").
SHEETS = [
    (Pole, []),
    (Entity, [("Pôle", "pole__name")]),
    (Direction, [("Pôle", "entity__pole__name"), ("Entité", "entity__name")]),
    (Department, [("Entité", "direction__entity__name"), ("Direction", "direction__name")]),
    (Position, [
        ("Entité", "department__direction__entity__name"),
        ("Direction", "department__direction__name"),
        ("Service", "department__name"),
    ]),
    (CostCenter, [("Code", "code")]),
    (Division, []), (Assignment, []), (Category, []), (ContractType, []),
    (TempAgency, []), (Grade, []), (Region, []), (Bank, []),
]


class Command(BaseCommand):
    help = "Export every reference list to an Excel file (one sheet per list) for HR to validate."

    def add_arguments(self, parser):
        parser.add_argument("--output", default="exports/listes_reference.xlsx")

    def handle(self, *args, output, **options):
        workbook = Workbook()
        workbook.remove(workbook.active)  # start without the default empty sheet

        for model, parents in SHEETS:
            # Excel refuses "/" in a sheet name and cuts it at 31 characters.
            title = str(model._meta.verbose_name_plural).capitalize().replace("/", "-")[:31]
            sheet = workbook.create_sheet(title)
            sheet.append([label for label, _ in parents] + ["Nom", "Actif"])
            for cell in sheet[1]:
                cell.font = Font(bold=True)

            fields = [field for _, field in parents]
            for *values, is_active in model.objects.order_by(*fields, "name").values_list(*fields, "name", "is_active"):
                sheet.append(values + ["Oui" if is_active else "Non"])

            sheet.freeze_panes = "A2"  # header stays visible while scrolling
            sheet.auto_filter.ref = sheet.dimensions
            for column in sheet.columns:
                width = max(len(str(cell.value or "")) for cell in column)
                sheet.column_dimensions[column[0].column_letter].width = min(width + 2, 60)

        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(path)
        self.stdout.write(self.style.SUCCESS(f"Exported {len(SHEETS)} lists to {path}"))
