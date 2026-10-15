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

