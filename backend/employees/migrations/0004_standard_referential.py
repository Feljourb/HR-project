from django.db import migrations

# Standard referential, a PROPOSAL until HR validates it
# (export it with: python manage.py export_lists).

BANKS = [
    # Classic banks
    "Al Barid Bank", "Arab Bank", "Attijariwafa bank", "Bank of Africa", "Banque Populaire",
    "BMCI", "CFG Bank", "CIH Bank", "Citibank Maghreb", "Crédit Agricole du Maroc",
    "Crédit du Maroc", "Saham Bank (ex-Société Générale Maroc)",
    # Participative banks
    "Al Akhdar Bank", "Bank Al Yousr", "Bank Assafa", "BTI Bank", "Umnia Bank",
]
REGIONS = [
    "Tanger-Tétouan-Al Hoceïma", "L'Oriental", "Fès-Meknès", "Rabat-Salé-Kénitra",
    "Béni Mellal-Khénifra", "Casablanca-Settat", "Marrakech-Safi", "Drâa-Tafilalet",
    "Souss-Massa", "Guelmim-Oued Noun", "Laâyoune-Sakia El Hamra", "Dakhla-Oued Ed-Dahab",
]
CATEGORIES = ["Cadre supérieur", "Cadre", "Agent de maîtrise", "Employé", "Ouvrier"]

# Direction -> Service -> Postes. The "Direction" service holds the director.
COMMON = {
    "Direction Générale": {
        "Direction": ["Directeur Général", "Directeur Général Adjoint", "Assistant(e) de direction"],
    },
    "Direction des Ressources Humaines": {
        "Direction": ["Directeur des Ressources Humaines"],
        "Administration du personnel & Paie": ["Responsable paie", "Gestionnaire paie", "Assistant(e) RH"],
        "Développement RH": ["Responsable développement RH", "Chargé(e) de recrutement", "Chargé(e) de formation"],
    },
    "Direction Administrative et Financière": {
        "Direction": ["Directeur Administratif et Financier"],
        "Comptabilité": ["Chef comptable", "Comptable", "Aide-comptable"],
        "Contrôle de gestion": ["Contrôleur de gestion"],
        "Trésorerie": ["Trésorier"],
    },
    "Direction des Systèmes d'Information": {
        "Direction": ["Directeur des Systèmes d'Information"],
        "Infrastructure & Réseaux": ["Administrateur systèmes et réseaux", "Technicien support"],
        "Développement": ["Chef de projet IT", "Développeur"],
    },
}
DISTRIBUTION = {  # pôle SBD
    "Direction Commerciale": {
        "Direction": ["Directeur Commercial"],
        "Ventes": ["Chef des ventes", "Superviseur des ventes", "Commercial terrain", "Prévendeur"],
        "Grands comptes": ["Key Account Manager"],
        "Trade Marketing": ["Responsable trade marketing", "Merchandiser"],
        "Administration des ventes": ["Responsable ADV", "Assistant(e) ADV"],
    },
    "Direction Logistique": {
        "Direction": ["Directeur Logistique"],
        "Entreposage": ["Chef d'entrepôt", "Magasinier", "Cariste", "Préparateur de commandes"],
        "Transport & Livraison": ["Responsable transport", "Chauffeur-livreur", "Aide-livreur"],
    },
    "Direction Supply Chain": {
        "Direction": ["Directeur Supply Chain"],
        "Achats": ["Responsable achats", "Acheteur"],
        "Approvisionnement & Planification": ["Planificateur", "Approvisionneur"],
    },
}
INDUSTRY = {  # pôle Riaya
    "Direction Industrielle": {
        "Direction": ["Directeur Industriel"],
        "Production": ["Responsable de production", "Chef d'équipe production", "Conducteur de ligne", "Opérateur de production"],
        "Méthodes": ["Ingénieur méthodes", "Technicien méthodes"],
    },
    "Direction Qualité": {
        "Direction": ["Directeur Qualité"],
        "Contrôle qualité": ["Responsable contrôle qualité", "Contrôleur qualité", "Technicien de laboratoire"],
        "Assurance qualité & HSE": ["Responsable assurance qualité", "Responsable HSE", "Animateur HSE"],
    },
    "Direction Maintenance": {
        "Direction": ["Directeur Maintenance"],
        "Maintenance": ["Responsable maintenance", "Technicien de maintenance", "Électromécanicien"],
    },
    "Direction Supply Chain": {
        "Direction": ["Directeur Supply Chain"],
        "Achats": ["Responsable achats", "Acheteur"],
        "Logistique": ["Responsable logistique", "Magasinier", "Cariste"],
        "Planification": ["Planificateur production"],
    },
}
ORGANISATION = {"SBD": COMMON | DISTRIBUTION, "Riaya": COMMON | INDUSTRY}


def add_values(apps, schema_editor):
    Entity = apps.get_model("employees", "Entity")
    Direction = apps.get_model("employees", "Direction")
    Department = apps.get_model("employees", "Department")
    Position = apps.get_model("employees", "Position")

    # name__iexact: a value HR already typed as "umnia bank" is not added again.
    for model_name, names in (("Bank", BANKS), ("Region", REGIONS), ("Category", CATEGORIES)):
        model = apps.get_model("employees", model_name)
        for name in names:
            model.objects.get_or_create(name__iexact=name, defaults={"name": name})

    for entity in Entity.objects.select_related("pole"):
        for direction_name, departments in ORGANISATION.get(entity.pole.name, {}).items():
            direction, _ = Direction.objects.get_or_create(
                entity=entity, name__iexact=direction_name, defaults={"name": direction_name})
            for department_name, positions in departments.items():
                department, _ = Department.objects.get_or_create(
                    direction=direction, name__iexact=department_name, defaults={"name": department_name})
                for position_name in positions:
                    Position.objects.get_or_create(
                        department=department, name__iexact=position_name, defaults={"name": position_name})


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0003_position_department"),
    ]

    operations = [
        migrations.RunPython(add_values, migrations.RunPython.noop),
    ]
