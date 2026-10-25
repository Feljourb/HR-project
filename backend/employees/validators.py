from django.core.exceptions import ObjectDoesNotExist, ValidationError


class NotCinValidator:
    """The CIN is the temporary password: the new password must not contain it."""

    def validate(self, password, user=None):
        try:
            cin = user.employee.cin
        except (AttributeError, ObjectDoesNotExist):  # no user, or no fiche (e.g. IT accounts)
            return
        if cin and cin in password.upper():
            raise ValidationError("Le mot de passe ne doit pas contenir votre CIN.", code="password_contains_cin")

    def get_help_text(self):
        return "Votre mot de passe ne doit pas contenir votre CIN."
