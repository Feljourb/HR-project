from django.core.exceptions import ObjectDoesNotExist, ValidationError


class NotCinValidator:
    """Refuse un nouveau mot de passe qui contient le CIN du collaborateur.

    Pourquoi : le CIN est le mot de passe temporaire, et beaucoup de collègues le
    connaissent. "AB123456!" serait presque aussi facile à deviner que "AB123456".

    C'est un "password validator" de Django : il est déclaré dans
    AUTH_PASSWORD_VALIDATORS (core/settings.py), donc il s'applique partout
    (page de changement de mot de passe, admin...).
    """

    def validate(self, password, user=None):
        # Django appelle cette méthode avec le mot de passe proposé et son utilisateur.
        try:
            cin = user.employee.cin
        except (AttributeError, ObjectDoesNotExist):
            # Pas d'utilisateur, ou utilisateur sans dossier RH (ex. un compte IT) : rien à vérifier.
            return
        # Le CIN est stocké en majuscules : on compare avec le mot de passe en majuscules.
        if cin and cin in password.upper():
            raise ValidationError("Le mot de passe ne doit pas contenir votre CIN.", code="password_contains_cin")

    def get_help_text(self):
        # Texte d'aide affiché par Django sous le champ mot de passe.
        return "Votre mot de passe ne doit pas contenir votre CIN."
