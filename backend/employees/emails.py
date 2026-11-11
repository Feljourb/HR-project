"""Les emails des notifications (2026-11-11) : une COPIE de la cloche 🔔 dans la boîte email pro.

Comment (le standard "outbox", comme un facteur) :
- une notification naît partout dans le code (le moteur, les congés, les rappels...) avec emailed_at vide :
  "pas encore traitée" ; RIEN n'est envoyé à ce moment-là (une demande n'attend jamais un serveur email) ;
- send_pending() (le facteur : `python manage.py send_emails --loop 30`, le service "mailer" de docker-compose)
  passe toutes les 30 secondes, envoie ce qui attend, et remplit emailed_at ;
- serveur en panne : la notification reste en attente et repart au passage suivant (au plus MAX_ATTEMPTS fois).
Pas envoyée (emailed_at rempli + la raison dans email_error) : déjà lue dans l'application, trop ancienne,
pas d'adresse email, compte désactivé. La cloche, elle, reste TOUJOURS là (décision du 2026-11-11).
"""
from datetime import timedelta
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

from . import notifications
from .models import Employee, Notification

MAX_ATTEMPTS = 5             # après 5 échecs, on abandonne (la cloche l'a toujours)
MAX_AGE = timedelta(days=2)  # une notification plus vieille n'est plus envoyée (elle n'est plus d'actualité)
BATCH = 50                   # au plus 50 emails par passage


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


def skip_reason(notification, to, now):
    """Pourquoi NE PAS envoyer cette notification par email (ou '' : on l'envoie)."""
    if notification.read_at:
        return "Déjà lue dans l'application."
    if now - notification.created_at > MAX_AGE:
        return "Trop ancienne."
    if not notification.recipient.is_active:
        return "Compte désactivé."
    if not to:
        return "Pas d'adresse email."
    return ""


def send_pending(limit=BATCH):
    """Un passage du facteur : envoie les notifications en attente. Rend {"sent", "skipped", "failed"}."""
    now = timezone.now()
    counts = {"sent": 0, "skipped": 0, "failed": 0}
    waiting = (Notification.objects.filter(emailed_at__isnull=True, email_attempts__lt=MAX_ATTEMPTS)
               .select_related("recipient", "employee", "request").order_by("created_at", "id")[:limit])
    for notification in waiting:
        to = address_of(notification.recipient)
        reason = skip_reason(notification, to, now)
        if reason:
            Notification.objects.filter(pk=notification.pk).update(emailed_at=now, email_error=reason)
            counts["skipped"] += 1
            continue
        try:
            build(notification, to).send()
        except Exception as error:  # serveur injoignable, refus, texte impossible à calculer... on réessaiera
            attempts = notification.email_attempts + 1
            Notification.objects.filter(pk=notification.pk).update(
                email_attempts=attempts, email_error=f"Essai {attempts} : {error}"[:300],
                # Le dernier essai raté : on arrête (la notification reste dans la cloche).
                emailed_at=now if attempts >= MAX_ATTEMPTS else None)
            counts["failed"] += 1
            continue
        Notification.objects.filter(pk=notification.pk).update(emailed_at=timezone.now(), email_error="")
        counts["sent"] += 1
    return counts
