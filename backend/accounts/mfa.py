"""Second factor (MFA): secret encryption, recovery codes, reset."""
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .models import RecoveryCode, SecuritySettings

RECOVERY_CODE_COUNT = 10
RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o or 1/l/i confusion


# --- Who needs MFA ------------------------------------------------------------

def is_required(user):
    return SecuritySettings.load().mfa_required_for(user)


def is_enabled(user):
    return user.mfa_enabled_at is not None


def setup_required(user):
    return is_required(user) and not is_enabled(user)


# --- Secret encryption (key in .env, never in the database) ------------------

def encrypt(secret):
    return Fernet(settings.MFA_ENCRYPTION_KEY).encrypt(secret.encode()).decode()


def decrypt(token):
    return Fernet(settings.MFA_ENCRYPTION_KEY).decrypt(token.encode()).decode()


# --- Recovery codes -----------------------------------------------------------

def _hash_code(code):
    normalized = code.lower().replace("-", "").replace(" ", "")
    key = settings.MFA_ENCRYPTION_KEY.encode()
    return hmac.new(key, normalized.encode(), hashlib.sha256).hexdigest()


def create_recovery_codes(user):
    """Replace the user's codes. Returns the plain codes: shown once, never stored."""
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    with transaction.atomic():
        user.recovery_codes.all().delete()
        RecoveryCode.objects.bulk_create(RecoveryCode(user=user, code_hash=_hash_code(c)) for c in codes)
    return codes


def use_recovery_code(user, code):
    """True if the code is valid and unused. It is then marked as used."""
    used = user.recovery_codes.filter(code_hash=_hash_code(code), used_at__isnull=True).update(
        used_at=timezone.now()
    )
    return used == 1


# --- Reset (IT action, e.g. lost phone) --------------------------------------

def reset(user):
    """The user will scan a new QR code at next login. All sessions are closed."""
    with transaction.atomic():
        user.mfa_secret = ""
        user.mfa_enabled_at = None
        user.mfa_last_step = None
        user.save(update_fields=["mfa_secret", "mfa_enabled_at", "mfa_last_step"])
        user.recovery_codes.all().delete()
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
