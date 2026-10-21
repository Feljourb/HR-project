"""Second factor (MFA): TOTP codes, secret encryption, recovery codes, reset."""
import base64
import hashlib
import hmac
import secrets

import pyotp
import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .models import RecoveryCode, SecuritySettings

ISSUER = "SBD HR Portal"  # name shown in the authenticator app
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


# --- TOTP codes (the 6 digits of the app) ------------------------------------

def pending_secret(user):
    """Secret of an activation in progress. Created once, reused if the page reloads."""
    if not user.mfa_secret:
        user.mfa_secret = encrypt(pyotp.random_base32())
        user.save(update_fields=["mfa_secret"])
    return decrypt(user.mfa_secret)


def qr_code(user, secret):
    """The QR code holds otpauth://totp/SBD HR Portal:username?secret=... as an SVG image."""
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.username, issuer_name=ISSUER)
    svg = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage).to_string()
    return "data:image/svg+xml;base64," + base64.b64encode(svg).decode()


def verify_code(user, code):
    """Accepts the current code, or the one just before/after (phone clock off by 30 s).
    A code works only once: we remember the last accepted time step."""
    if not user.mfa_secret:
        return False
    totp = pyotp.TOTP(decrypt(user.mfa_secret))
    code = code.replace(" ", "")
    now_step = totp.timecode(timezone.now())
    last_step = user.mfa_last_step if user.mfa_last_step is not None else -1
    for step in (now_step - 1, now_step, now_step + 1):
        if step > last_step and hmac.compare_digest(totp.generate_otp(step), code):
            user.mfa_last_step = step
            user.save(update_fields=["mfa_last_step"])
            return True
    return False


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
