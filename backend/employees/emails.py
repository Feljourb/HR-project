"""Les emails des notifications (2026-11-11) : une COPIE de la cloche 🔔 dans la boîte email pro.

Comment (le standard "outbox", comme un facteur) :
- une notification naît partout dans le code (le moteur, les congés, les rappels...) avec emailed_at vide :
  "pas encore traitée" ; RIEN n'est envoyé à ce moment-là (une demande n'attend jamais un serveur email) ;
- send_pending() (le facteur : `python manage.py send_emails --loop 30`, le service "mailer" de docker-compose)
  passe toutes les 30 secondes, envoie ce qui attend, et remplit emailed_at ;
- RIEN ne se perd (décision du 2026-11-11, une vraie application) : facteur arrêté (mise à jour du serveur,
  plantage : Docker le relance), tout attend dans la base et part quand il revient, même des jours après ;
- serveur email en panne / mot de passe expiré : on réessaie de plus en plus tard (RETRY_MINUTES : 1 min ...
  12 h, plus d'une journée en tout) ; ensuite "Échec" : visible dans /admin (Notifications, filtre "Email en
  échec") avec la raison, et l'IT clique "Renvoyer l'email" une fois le problème réglé.
Pas envoyée (emailed_at rempli + la raison dans email_error) : pas d'adresse email, compte désactivé, ou
l'utilisateur a désactivé cette famille d'emails dans Settings ("à valider" : toujours envoyé). Déjà lue dans l'application : envoyée quand même (le standard RH). La cloche reste TOUJOURS là.
"""
from datetime import timedelta
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db.models import Q
from django.utils import timezone

from . import notifications
from .models import Employee, Notification, NotificationSettings

# Les 3 familles d'emails (page Settings). Kind = Notification.Kind.
Kind = Notification.Kind
ALWAYS = {Kind.TO_VALIDATE, Kind.DELEGATED, Kind.TRIAL_END}           # il faut agir : toujours envoyé
RESULTS = {Kind.APPROVED, Kind.REJECTED, Kind.CANCELLED, Kind.RECOUNTED, Kind.EXPIRED}  # mes demandes : "email_results"
# Le reste (pour information, solde corrigé, droit changé, jours perdus le 31/12, rappels, "pas encore validée") :
# "email_info".


def wanted(notification):
    """Cet utilisateur veut-il CETTE famille d'emails ? (Pas de réglage enregistré = oui.)"""
    if notification.kind in ALWAYS:
        return True
    choices = NotificationSettings.objects.filter(user=notification.recipient_id).first()
    if choices is None:
        return True
    return choices.email_results if notification.kind in RESULTS else choices.email_info

# Après le 1er échec, on réessaie dans 1 min ; après le 2e, dans 5 min... (plus de 27 h en tout).
RETRY_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 720]
MAX_ATTEMPTS = len(RETRY_MINUTES) + 1  # 10 essais ; ensuite "Échec" dans /admin, et l'IT renvoie
BATCH = 50                             # au plus 50 emails par passage (le reste au passage suivant)
FAILED = "Échec"                       # le début de email_error d'un email abandonné (le filtre de /admin)


def address_of(user):
    """L'email pro du dossier RH (ex. f.alami@silent-believers.com) ; sinon l'email du compte ; sinon ''."""
    employee = Employee.objects.filter(user=user).only("first_name", "professional_email").first()
    return (employee.professional_email if employee else "") or user.email or ""


def build(notification, to):
    """L'email : un objet clair, le même texte que la cloche, et un bouton vers la bonne page."""
    employee = Employee.objects.filter(user=notification.recipient).only("first_name").first()
    hello = f"Bonjour {employee.first_name}," if employee else "Bonjour,"
    title = notification.get_kind_display()
    text = notifications.message(notification)
    url = f"{settings.FRONTEND_URL.rstrip('/')}{notifications.link(notification)}"
    footer = "Cet email est envoyé automatiquement par l'Intranet RH, merci de ne pas y répondre."

    plain = f"{hello}\n\n{text}\n\nOuvrir dans l'Intranet RH : {url}\n\n-- \n{footer}\n"
    # Le HTML : simple et "inline" (les logiciels email ignorent les feuilles de style).
    html = f"""<div style="background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
    <div style="background:#192646;color:#ffffff;padding:14px 20px;font-size:14px;font-weight:bold">Intranet RH</div>
    <div style="padding:20px;color:#0f172a;font-size:14px;line-height:1.5">
      <p style="margin:0 0 4px;font-size:11px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#8c6d52">{escape(title)}</p>
      <p style="margin:0 0 12px">{escape(hello)}</p>
      <p style="margin:0 0 20px">{escape(text)}</p>
      <a href="{escape(url)}" style="display:inline-block;background:#192646;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold;font-size:13px">Ouvrir dans l'Intranet RH</a>
    </div>
    <div style="padding:12px 20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px">{escape(footer)}</div>
  </div>
</div>"""
    email = EmailMultiAlternatives(subject=f"[Intranet RH] {title}", body=plain, from_email=settings.DEFAULT_FROM_EMAIL, to=[to])
    email.attach_alternative(html, "text/html")
    return email


def skip_reason(notification, to):
    """Pourquoi NE PAS envoyer cette notification par email (ou '' : on l'envoie).
    Déjà lue dans l'application : envoyée QUAND MÊME (le standard des logiciels RH, décision du 2026-11-11) :
    l'email est la trace écrite (à valider, acceptée, refusée...), chaque notification a son email.
    Ancienne (le facteur était arrêté) : envoyée aussi, rien ne se perd."""
    if not notification.recipient.is_active:
        return "Compte désactivé."
    if not wanted(notification):
        return "Désactivé par l'utilisateur (Settings)."
    if not to:
        return "Pas d'adresse email."
    return ""


def send_pending(limit=BATCH):
    """Un passage du facteur : envoie les notifications en attente. Rend {"sent", "skipped", "failed"}."""
    now = timezone.now()
    counts = {"sent": 0, "skipped": 0, "failed": 0}
    # Ce qui attend : pas encore traité, pas abandonné, et (après un échec) l'heure du prochain essai est passée.
    waiting = (Notification.objects
               .filter(emailed_at__isnull=True, email_attempts__lt=MAX_ATTEMPTS)
               .filter(Q(email_next_try__isnull=True) | Q(email_next_try__lte=now))
               .select_related("recipient", "employee", "request").order_by("created_at", "id")[:limit])
    for notification in waiting:
        to = address_of(notification.recipient)
        reason = skip_reason(notification, to)
        if reason:
            Notification.objects.filter(pk=notification.pk).update(emailed_at=now, email_error=reason)
            counts["skipped"] += 1
            continue
        try:
            build(notification, to).send()
        except Exception as error:  # serveur injoignable, mot de passe refusé... : on réessaiera plus tard
            attempts = notification.email_attempts + 1
            if attempts >= MAX_ATTEMPTS:
                # Plus d'une journée d'échecs : "Échec", visible dans /admin ; l'IT renvoie après avoir réglé le problème.
                Notification.objects.filter(pk=notification.pk).update(
                    email_attempts=attempts, email_next_try=None, email_error=f"{FAILED} après {attempts} essais : {error}"[:300])
            else:
                Notification.objects.filter(pk=notification.pk).update(
                    email_attempts=attempts, email_error=f"Essai {attempts} : {error}"[:300],
                    email_next_try=now + timedelta(minutes=RETRY_MINUTES[attempts - 1]))
            counts["failed"] += 1
            continue
        Notification.objects.filter(pk=notification.pk).update(emailed_at=timezone.now(), email_error="", email_next_try=None)
        counts["sent"] += 1
    return counts


def resend(queryset):
    """L'IT a réglé le problème (mot de passe, serveur...) : ces emails repartent au prochain passage du facteur."""
    return queryset.filter(emailed_at__isnull=True).update(email_attempts=0, email_next_try=None, email_error="")
