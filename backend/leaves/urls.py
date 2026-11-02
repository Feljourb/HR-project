"""Adresses de l'app leaves (incluses sous /api/leaves/ dans core/urls.py)."""
from rest_framework.routers import SimpleRouter

from employees.views import make_viewset

from .models import LeaveType, PublicHoliday
from .serializers import HolidayListSerializer
from .views import AbsenceViewSet, LeaveTypeViewSet, MyLeaveViewSet, PublicHolidayViewSet


class HolidayListViewSet(make_viewset(PublicHoliday)):
    serializer_class = HolidayListSerializer  # le message "date déjà prise" en français (voir le serializer)

app_name = "leaves"

router = SimpleRouter()
# Step 8 : les deux listes du module dans la page "Reference lists" (Admin RH : ajouter, modifier, désactiver),
# avec EXACTEMENT les mêmes règles que les autres listes (make_viewset de l'app employees) :
# GET pour tous (?all=1 : aussi les désactivées, Admin RH), POST / PATCH Admin RH, jamais DELETE.
router.register("lists/leave-types", make_viewset(LeaveType), basename="list-leave-types")
router.register("lists/public-holidays", HolidayListViewSet, basename="list-public-holidays")
# Step 8 : les absences du pôle (RH).
router.register("absences", AbsenceViewSet, basename="absence")

router.register("types", LeaveTypeViewSet, basename="type")
router.register("holidays", PublicHolidayViewSet, basename="holiday")
router.register("mine", MyLeaveViewSet, basename="mine")  # "leaves:mine-list", "leaves:mine-preview"...

urlpatterns = router.urls
