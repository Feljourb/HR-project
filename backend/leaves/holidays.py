"""Les jours fériés se créent TOUT SEULS, année par année (décision du 2026-11-02 : Admin RH ne les tape pas).

Comme un calendrier qui s'imprime la première fois qu'on ouvre une nouvelle année :
ensure_year(2028) crée les jours fériés de 2028 s'ils n'existent pas encore. On l'appelle quand on en a
besoin (compter un congé, afficher la liste) : pas de tâche planifiée à oublier.

- Fêtes à date FIXE (Marche Verte...) : la même date chaque année, sûre.
- Fêtes RELIGIEUSES (Aïd, Mawlid, 1er Moharram) : calendrier hégirien (bibliothèque hijridate, sans internet).
  La date officielle au Maroc dépend de la lune et peut être décalée d'un jour : elles sont créées
  "estimées" ; Admin RH corrige la date si besoin (page Reference lists) et décoche "estimée".
Une fête déjà créée (même renommée, déplacée ou désactivée par Admin RH) n'est jamais recréée : sa `key` la retrouve.
"""
import datetime

from hijridate import Gregorian, Hijri

from .models import PublicHoliday

# (mois, jour, code, nom) : les fêtes nationales à date fixe.
FIXED = [
    (1, 1, "NEW_YEAR", "Nouvel An"),
    (1, 11, "INDEPENDENCE_MANIFESTO", "Manifeste de l'Indépendance"),
    (1, 14, "AMAZIGH_NEW_YEAR", "Nouvel An amazigh"),
    (5, 1, "LABOUR_DAY", "Fête du Travail"),
    (7, 30, "THRONE_DAY", "Fête du Trône"),
    (8, 14, "OUED_ED_DAHAB", "Allégeance Oued Ed-Dahab"),
    (8, 20, "REVOLUTION", "Révolution du Roi et du Peuple"),
    (8, 21, "YOUTH_DAY", "Fête de la Jeunesse"),
    (10, 31, "UNITY_DAY", "Fête de l'Unité"),
    (11, 6, "GREEN_MARCH", "Marche Verte"),
    (11, 18, "INDEPENDENCE_DAY", "Fête de l'Indépendance"),
]

# (mois hégirien, jour, code, nom) : les fêtes religieuses chômées au Maroc.
RELIGIOUS = [
    (1, 1, "MOHARRAM", "1er Moharram"),
    (3, 12, "MAWLID_1", "Aïd Al Mawlid"),
    (3, 13, "MAWLID_2", "Aïd Al Mawlid (2e jour)"),
    (10, 1, "FITR_1", "Aïd Al Fitr"),
    (10, 2, "FITR_2", "Aïd Al Fitr (2e jour)"),
    (12, 10, "ADHA_1", "Aïd Al Adha"),
    (12, 11, "ADHA_2", "Aïd Al Adha (2e jour)"),
]


def expected(year):
    """Les jours fériés prévus pour cette année : [(key, date, nom, estimée ?), ...]."""
    rows = [(f"{code}-{year}", datetime.date(year, month, day), name, False) for month, day, code, name in FIXED]
    try:
        # Une année grégorienne touche 2 années hégiriennes (l'année lunaire fait ~354 jours) :
        # on regarde les deux, et on garde les fêtes qui tombent DANS cette année.
        first, last = Gregorian(year, 1, 1).to_hijri().year, Gregorian(year, 12, 31).to_hijri().year
        for hijri_year in range(first, last + 1):
            for month, day, code, name in RELIGIOUS:
                date = datetime.date(*Hijri(hijri_year, month, day).to_gregorian().datetuple())
                if date.year == year:
                    # La clé porte l'année HÉGIRIENNE : une fête peut tomber deux fois la même année grégorienne.
                    rows.append((f"{code}-{hijri_year}H", date, name, True))
    except (OverflowError, ValueError):
        pass  # année hors du calendrier de la bibliothèque (avant 1924 / après 2077) : seulement les fêtes fixes
    return rows


def ensure_year(year):
    """Crée les jours fériés de cette année qui manquent (2 petites requêtes quand tout existe déjà)."""
    rows = expected(year)
    known = set(PublicHoliday.objects.filter(key__in=[row[0] for row in rows]).values_list("key", flat=True))
    taken = set(PublicHoliday.objects.filter(date__year=year).values_list("date", flat=True))
    new = [PublicHoliday(key=key, date=date, name=name, estimated=estimated)
           for key, date, name, estimated in rows if key not in known and date not in taken]
    # Un jour déjà férié (ex. ajouté à la main) n'est pas doublé : la date est unique.
    # ignore_conflicts : deux requêtes en même temps qui créent la même année ne plantent pas.
    PublicHoliday.objects.bulk_create(new, ignore_conflicts=True)


def ensure_years(start, end):
    for year in range(start.year, end.year + 1):
        ensure_year(year)
