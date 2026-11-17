"""Le publipostage (2026-11-17) : le modèle Word d'un type (mis par Admin RH) contient des codes {{ nom }},
{{ cin }}... ; quand un RH clique "Download", l'application les remplace par les vraies données du collaborateur et
rend un Word rempli, que le RH relit, imprime, signe et tamponne.

Fait avec la bibliothèque docxtpl (le standard en Python : elle retrouve un code même quand Word l'a coupé en
plusieurs morceaux). Un code inconnu (faute de frappe) devient vide ; un code mal fermé ("{{ nom") est refusé dès
qu'Admin RH met le modèle (check_model), avec un message clair.
"""
import re
from io import BytesIO

from django.core.exceptions import ValidationError
from django.utils import timezone
from docxtpl import DocxTemplate
from jinja2 import TemplateSyntaxError

from employees.models import Employee

# Les codes proposés à Admin RH (affichés dans la page Réglages des documents) : code -> ce qu'il donne.
CODES = {
    "civilite": "Monsieur / Madame",
    "nom": "Nom (en majuscules)",
    "prenom": "Prénom",
    "cin": "N° CIN",
    "matricule": "Matricule",
    "cnss": "N° CNSS",
    "date_naissance": "Date de naissance",
    "date_embauche": "Date d'embauche",
    "date_sortie": "Date de sortie (vide si en poste)",
    "poste": "Poste",
    "service": "Service",
    "direction": "Direction",
    "societe": "Société (entité)",
    "pole": "Pôle",
    "ville": "Ville du signataire (« Fait à »)",
    "date_du_jour": "Date du jour",
    "reference": "Référence du document",
    "motif": "Motif de la demande (ex. Banque)",
}


def values_of(document):
    """Les vraies données pour CE document (le collaborateur de la demande)."""
    from .pdf import signatory_of  # (pdf importe les modèles : importé ici, au moment du besoin)
    employee = document.employee
    day = lambda value: f"{value:%d/%m/%Y}" if value else ""  # noqa: E731
    return {
        "civilite": "Madame" if employee.title == Employee.Title.MRS else "Monsieur",
        "nom": employee.last_name.upper(),
        "prenom": employee.first_name,
        "cin": employee.cin,
        "matricule": employee.u_number or "",
        "cnss": employee.cnss_number,
        "date_naissance": day(employee.birth_date),
        "date_embauche": day(employee.hire_date),
        "date_sortie": day(employee.departure_date),
        "poste": employee.position.name,
        "service": employee.department.name,
        "direction": employee.department.direction.name,
        "societe": employee.department.direction.entity.name,
        "pole": employee.department.direction.entity.pole.name,
        "ville": signatory_of(employee).city,
        "date_du_jour": day(timezone.localdate()),
        "reference": document.reference or "",
        "motif": document.purpose,
    }


CODE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def merge_text(template, values):
    """Le modèle de TEXTE d'Admin RH (2026-11-17) -> le texte rempli : chaque {{ code }} remplacé par sa valeur
    (un code inconnu devient vide). Le PDF est ensuite fabriqué comme l'attestation de travail."""
    return CODE.sub(lambda match: str(values.get(match.group(1), "")), template)


def fill(model_file, values):
    """Le modèle Word avec ses codes remplacés -> les octets du Word rempli."""
    with model_file.open("rb") as source:
        template = DocxTemplate(BytesIO(source.read()))
    template.render(values)
    out = BytesIO()
    template.save(out)
    return out.getvalue()


def check_model(file):
    """Admin RH met un modèle .docx : ses codes doivent être bien écrits ({{ nom }}), sinon un message clair."""
    try:
        template = DocxTemplate(BytesIO(file.read()))
        template.render({code: "x" for code in CODES})
    except TemplateSyntaxError as error:
        raise ValidationError(f"Un code du modèle est mal écrit (ligne {error.lineno}) : écrivez-les comme {{{{ nom }}}}.")
    except Exception:  # noqa: BLE001 (un fichier qui n'est pas un vrai Word)
        raise ValidationError("Ce fichier n'est pas un document Word (.docx) lisible.")
    finally:
        file.seek(0)
