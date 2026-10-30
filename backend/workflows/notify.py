"""
Les notifications de la cloche 🔔 pour les demandes (step 7).

Le moteur (engine.py) les envoie au moment où ça se passe :
- une étape "Valider" attend quelqu'un      -> "Demande à valider" (le N+1, ou tous les RH du pôle...) ;
- une étape "Informer" est atteinte          -> "Pour information" ;
- la demande est acceptée / refusée          -> le demandeur est prévenu ;
- quelqu'un a répondu, ou la demande est annulée -> les "Demande à valider" pas encore lues partent
  (elles n'attendent plus personne). Celles déjà lues restent : c'est l'historique de la personne.

Les notifications vivent dans la table de la cloche (employees.Notification), à côté de la fin de période d'essai.
"""
from employees.models import Notification

Kind = Notification.Kind


def send(users, kind, request):
    """Une notification de ce type, pour chacun de ces comptes."""
    Notification.objects.bulk_create(
        Notification(recipient=user, employee=request.requester, kind=kind, request=request) for user in users
    )


def clear_waiting(request):
    """La demande n'attend plus ces personnes : leurs "Demande à valider" pas encore lues sont retirées."""
    Notification.objects.filter(request=request, kind=Kind.TO_VALIDATE, read_at__isnull=True).delete()
