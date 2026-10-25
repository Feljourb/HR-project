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
from django.core import signing
from django.db import transaction
from django.utils import timezone
from .models import RecoveryCode, SecuritySettings, User
from .services import logout_everywhere

ISSUER = "SBD HR Portal"  # name shown in the authenticator app
PENDING_MAX_AGE = 5 * 60  # seconds between the password and the code
TRUSTED_MAX_AGE = 30 * 24 * 3600  # "trust this device for 30 days"
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


# --- Login in two steps (signed cookies: they cannot be forged) ---------------

def pending_token(user):
    """Proof that the password was correct, valid 5 minutes. It is NOT a session."""
    return signing.dumps(user.pk, salt="mfa-pending")


def pending_user(request):
    token = request.COOKIES.get("mfa_pending")
    if not token:
        return None
    try:
        user_id = signing.loads(token, salt="mfa-pending", max_age=PENDING_MAX_AGE)
    except signing.BadSignature:  # forged or expired
        return None
    return User.objects.filter(pk=user_id, is_active=True).first()


def trusted_token(user):
    # Tied to the activation date: an IT reset invalidates every trusted device.
    return signing.dumps([user.pk, user.mfa_enabled_at.isoformat()], salt="mfa-trusted")


def is_trusted_device(request, user):
    token = request.COOKIES.get("mfa_trusted")
    if not token or user.mfa_enabled_at is None:
        return False
    try:
        data = signing.loads(token, salt="mfa-trusted", max_age=TRUSTED_MAX_AGE)
    except signing.BadSignature:
        return False
    return data == [user.pk, user.mfa_enabled_at.isoformat()]


def must_enter_code(request, user):
    """At login: MFA required, already activated, and this device is not trusted."""
    return is_required(user) and is_enabled(user) and not is_trusted_device(request, user)


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
        logout_everywhere(user)
