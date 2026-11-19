'use client'

/*
 * "Réglages des congés" : TOUT au même endroit (2026-11-19, l'utilisatrice : "c'est séparé, on oublie" ; même modèle
 * que Réglages des notes de frais et des documents). Avant : 3 entrées dans Reference lists.
 *   ① Leave types : le tableau des types + une légende (ce que veut dire chaque colonne) ;
 *   ② Public holidays : une année à la fois (holidays-panel.tsx, inchangé) ;
 *   ③ Balance rules : 2 ans, max 36, ancienneté, 6 mois (leave-settings-panel.tsx, inchangé).
 * 2026-11-19 : la page était trop longue -> 3 onglets (settings-tabs.tsx), une section visible à la fois.
 */
import { CalendarDays, ListChecks, Scale } from 'lucide-react'
import { HolidaysPanel } from './holidays-panel'
import { LeaveSettingsPanel } from './leave-settings-panel'
import { ListCard } from './list-card'
import { HOLIDAYS_LIST, LEAVE_TYPES_LIST } from './lists-config'
import { SettingsTabs } from './settings-tabs'

// La légende du tableau : chaque colonne en mots simples, avec un exemple (règle "Don't Make Me Think").
const LEGEND: [string, string][] = [
  ['Taken from the balance', 'Yes = the days come out of the employee’s balance (annual leave). No = the balance does not change (sick, wedding…).'],
  ['Legal maximum', 'The most days for ONE request (e.g. own wedding = 4 days). — = no maximum.'],
  ['Days in the past allowed', 'How many days back the leave may start when the employee asks (e.g. sick = 2: ill yesterday, asks today). 0 = today or later.'],
  ['Counting', 'Working days: Monday–Friday = 1, Saturday = ½, Sunday and public holidays = 0. Calendar days: every day = 1 (maternity: 98 days = 14 weeks).'],
  ['Document from', 'From how many days a supporting document is asked (1 = always). — = never.'],
]

export function LeaveSettingsAll() {
  return <SettingsTabs title="Réglages des congés" storageKey="leave-settings-tab"
    text="Everything about leaves in one place. Choose a section."
    tabs={[
      { id: 'types', label: 'Leave types', icon: ListChecks, hint: 'What employees can ask for (annual, sick, wedding…) and the rules of each type.',
        content: <ListCard list={LEAVE_TYPES_LIST} title="Leave types" addLabel="Add a type" legend={LEGEND}
          text="What employees can ask for, and the rules of each type. The legend under the table explains each column." /> },
      { id: 'holidays', label: 'Public holidays', icon: CalendarDays, content: <HolidaysPanel list={HOLIDAYS_LIST} />,
        hint: 'The days off of each year: they count 0 in a leave. Created automatically; correct a religious date here.' },
      { id: 'rules', label: 'Balance rules', icon: Scale, content: <LeaveSettingsPanel />,
        hint: 'How the balance is earned and lost: 2 years to take the days, maximum per year, seniority, first leave after 6 months.' },
    ]} />
}
