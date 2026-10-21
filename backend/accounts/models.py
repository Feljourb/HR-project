from django.db import models
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    class Role(models.TextChoices):
        HR_ADMIN = "HR_ADMIN", "Admin RH"
        HR = "HR", "RH"
        MANAGER = "MANAGER", "Manager"
        COLLABORATOR = "COLLABORATOR", "Collaborateur"


    first_name = None
    last_name = None

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.COLLABORATOR)
    must_change_password = models.BooleanField(default=False)


class SecuritySettings(models.Model):
    """A single row that IT edits in the Django admin (no redeploy needed)."""

    mfa_enabled = models.BooleanField("MFA activé", default=False)
    mfa_required_hr_admin = models.BooleanField("Admin RH", default=True)
    mfa_required_hr = models.BooleanField("RH", default=True)
    mfa_required_manager = models.BooleanField("Manager", default=True)
    mfa_required_collaborator = models.BooleanField("Collaborateur", default=False)
    mfa_required_superuser = models.BooleanField("IT (superuser)", default=True)

    class Meta:
        verbose_name = "Réglages de sécurité"
        verbose_name_plural = "Réglages de sécurité"

    def __str__(self):
        return "Réglages de sécurité"

    def save(self, *args, **kwargs):
        self.pk = 1  # always the same row
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        settings, _ = cls.objects.get_or_create(pk=1)
        return settings

    def mfa_required_for(self, user):
        if not self.mfa_enabled:
            return False
        if user.is_superuser and self.mfa_required_superuser:
            return True
        return {
            User.Role.HR_ADMIN: self.mfa_required_hr_admin,
            User.Role.HR: self.mfa_required_hr,
            User.Role.MANAGER: self.mfa_required_manager,
            User.Role.COLLABORATOR: self.mfa_required_collaborator,
        }.get(user.role, False)

