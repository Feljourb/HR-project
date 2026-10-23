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
    must_change_password = models.BooleanField(default=True)

    # Second factor (TOTP). The secret is encrypted, see accounts/mfa.py.
    mfa_secret = models.TextField(blank=True)
    mfa_enabled_at = models.DateTimeField(null=True, blank=True)
    mfa_last_step = models.BigIntegerField(null=True, blank=True)  # last accepted code: no reuse

    def password_change_required(self):
        return self.must_change_password and SecuritySettings.load().password_required_for(self)


class RecoveryCode(models.Model):
    """One-time codes for a lost phone. Only a hash is stored, like a password."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recovery_codes")
    code_hash = models.CharField(max_length=64)
    used_at = models.DateTimeField(null=True, blank=True)


class SecuritySettings(models.Model):
    """A single row that IT edits in the Django admin (no redeploy needed)."""

    mfa_enabled = models.BooleanField("MFA activé", default=False)
    mfa_required_hr_admin = models.BooleanField("Admin RH", default=True)
    mfa_required_hr = models.BooleanField("RH", default=True)
    mfa_required_manager = models.BooleanField("Manager", default=True)
    mfa_required_collaborator = models.BooleanField("Collaborateur", default=False)
    mfa_required_superuser = models.BooleanField("IT (superuser)", default=True)

    password_change_enabled = models.BooleanField("Changement de mot de passe activé", default=True)
    password_change_hr_admin = models.BooleanField("Admin RH", default=True)
    password_change_hr = models.BooleanField("RH", default=True)
    password_change_manager = models.BooleanField("Manager", default=True)
    password_change_collaborator = models.BooleanField("Collaborateur", default=True)
    password_change_superuser = models.BooleanField("IT (superuser)", default=False)

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

    def password_required_for(self, user):
        if not self.password_change_enabled:
            return False
        if user.is_superuser:
            return self.password_change_superuser
        if user.role == User.Role.HR_ADMIN:
            return self.password_change_hr_admin
        if user.role == User.Role.HR:
            return self.password_change_hr
        if user.role == User.Role.MANAGER:
            return self.password_change_manager
        if user.role == User.Role.COLLABORATOR:
            return self.password_change_collaborator
        return False
