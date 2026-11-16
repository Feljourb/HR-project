"""make rates : met à jour les taux de change MAINTENANT (sinon c'est fait chaque matin par le facteur)."""
from django.core.management.base import BaseCommand, CommandError

from ...models import Currency
from ...rates import update_rates


class Command(BaseCommand):
    help = "Met à jour les taux de change des devises (notes de frais)."

    def handle(self, *args, **options):
        try:
            updated = update_rates()
        except Exception as error:  # pas d'internet, site en panne...
            raise CommandError(f"Taux pas mis à jour ({error}) : l'application garde les derniers taux connus.")
        for currency in Currency.objects.filter(is_active=True).order_by("name"):
            self.stdout.write(f"- 1 {currency.name} = {currency.rate_to_mad} MAD"
                              f"{' (mis à jour)' if currency.name in updated else ''}")
