'use client'

/*
 * Le "cadre" commun à toutes les pages connectées : la barre de navigation à gauche
 * (sidebar) et la barre du haut (header). Il est affiché une seule fois, par le layout
 * de app/(app) ; chaque page n'est que le contenu au milieu.
 * Le lien surligné et le fil d'Ariane viennent de l'adresse de la page (voir pageInfo).
 *
 * Sidebar refaite le 2026-11-13 (demandé par l'utilisateur : "moderne", standard Linear / Vercel / Notion) :
 * - des sections TOUJOURS ouvertes avec un petit titre (plus d'accordéon : un clic de moins pour chaque page) ;
 * - la page actuelle : fond plus clair + une barre à gauche ;
 * - de VRAIS compteurs (demandes à valider, documents à préparer), plus le "2" écrit en dur ;
 * - les pages pas encore faites sont rangées dans "Coming soon" (fermé), au lieu de boutons qui ne font rien ;
 * - grand écran : le bouton ☰ réduit la sidebar en icônes (le nom de chaque lien en info-bulle) ;
 * - téléphone : la sidebar s'ouvre PAR-DESSUS la page, avec un fond sombre, et se ferme après un clic.
 */
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  BookOpen, BriefcaseBusiness, Building2, CalendarDays, CalendarRange, Check, ChevronRight, ChevronsUpDown,
  CircleHelp, ClipboardCheck, FileText, FolderOpen, Headphones, Inbox, LayoutDashboard, ListChecks, LockKeyhole, type LucideIcon,
  LogOut, Menu, PiggyBank, Plane, ReceiptText, ScrollText, Search, Sparkles, UserRound, UserRoundCheck, UserRoundCog, UsersRound, Workflow, X,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BrandLogo } from '@/components/brand-logo'
import { Input } from '@/components/ui/input'
import { NotificationBell } from '@/components/notification-bell'
import { UserMenu } from '@/components/user-menu'
import { accountLabel, apiFetch, isHr, seesBothPoles, type Me } from '@/lib/api'
import { cn } from '@/lib/utils'

type Counter = 'approvals' | 'documents'  // le nombre affiché à droite du lien (voir useCounters)

type NavItem = {
  label: string
  icon: LucideIcon
  href: string
  hrOnly?: boolean   // visible seulement pour RH et Admin RH
  adminOnly?: boolean  // visible seulement pour Admin RH (et l'IT)
  itOnly?: boolean     // visible seulement pour l'IT (superuser)
  standInOnly?: boolean  // visible seulement pour un collaborateur choisi comme délégué (les autres ont Team approvals)
  counter?: Counter
}

type NavGroup = {
  label: string
  restricted?: boolean  // section cachée aux collaborateurs (managers et RH la voient)
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  { label: 'My space', items: [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    { label: 'My Profile', icon: UserRound, href: '/profile' },
    { label: 'My Requests', icon: Inbox, href: '/requests' },
    { label: 'Leave Requests', icon: CalendarDays, href: '/leaves' },
    { label: 'Expense Claims', icon: ReceiptText, href: '/expenses' },
    { label: 'Administrative Documents', icon: FolderOpen, href: '/documents' },
    { label: 'Stand-in requests', icon: UserRoundCheck, href: '/stand-in', standInOnly: true, counter: 'approvals' },
  ] },
  // L'annuaire est ouvert à tous les rôles.
  { label: 'Company', items: [
    { label: 'Employee Directory', icon: UsersRound, href: '/directory' },
  ] },
  { label: 'Management & HR', restricted: true, items: [
    { label: 'Team Approvals', icon: Check, href: '/approvals', counter: 'approvals' },
    // P2 step 2b : mon équipe (les personnes dont je suis le N+1), qui est absent, mois par mois.
    { label: 'Team Calendar', icon: CalendarRange, href: '/team-calendar' },
    { label: 'Employees', icon: UserRoundCog, href: '/employees', hrOnly: true },
    { label: 'Absences', icon: CalendarDays, href: '/absences', hrOnly: true },
    { label: 'Leave balances', icon: PiggyBank, href: '/leave-balances', hrOnly: true },
    { label: 'Reimbursements', icon: ReceiptText, href: '/reimbursements', hrOnly: true },
    { label: 'Document requests', icon: FileText, href: '/document-requests', hrOnly: true, counter: 'documents' },
    { label: 'Audit log', icon: ScrollText, href: '/audit', hrOnly: true },
  ] },
  // Les réglages de l'application : à part (standard), seulement Admin RH et l'IT.
  { label: 'Administration', restricted: true, items: [
    { label: 'Reference lists', icon: ListChecks, href: '/lists', adminOnly: true },
    { label: 'Workflows', icon: Workflow, href: '/workflows', adminOnly: true },
    { label: 'Security settings', icon: LockKeyhole, href: '/security', itOnly: true },
  ] },
]

// Les pages prévues mais pas encore faites : montrées dans "Coming soon" (la feuille de route), jamais cliquables.
const COMING_SOON: { label: string; icon: LucideIcon }[] = [
  { label: 'Meeting Room Booking', icon: Building2 },
  { label: 'Travel & Hotel', icon: Plane },
  { label: 'IT Helpdesk', icon: Headphones },
  { label: 'Training Catalog', icon: BookOpen },
  { label: 'Performance Reviews', icon: ClipboardCheck },
  { label: 'Internal Job Postings', icon: BriefcaseBusiness },
]

/** "fatima.zahra" -> "Fatima Zahra" */
export function displayNameOf(username: string) {
  return username.split('.').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

// Les sous-pages qui ne sont pas dans le menu : leur nom dans le fil d'Ariane.
const SUB_PAGES: [RegExp, string][] = [
  [/^\/employees\/new$/, 'New employee'],
  [/^\/employees\/\d+$/, 'Employee file'],
  [/^\/requests\/\d+$/, 'Request history'],
  [/^\/expenses\/\d+$/, 'Expense claim'],
]

// Une page détail ouverte depuis une autre page (?from=...) : le lien surligné est celui de la page d'origine.
// Ex. un manager ouvre la demande d'un collaborateur depuis la cloche : "Team Approvals", pas "My Requests".
const FROM_ITEM: Record<string, string> = {
  requests: 'My Requests', received: 'My Requests', leaves: 'Leave Requests', expenses: 'Expense Claims', approvals: 'Team Approvals',
  'stand-in': 'Stand-in requests', absences: 'Absences', 'leave-balances': 'Leave balances', reimbursements: 'Reimbursements',
  documents: 'Administrative Documents', 'document-requests': 'Document requests',
}

/**
 * Le lien surligné et le fil d'Ariane, déduits de l'adresse de la page (et de ?from= pour une page détail).
 * Ex. "/employees/7" -> lien "Employees", fil "Management & HR > Employee file".
 */
function pageInfo(pathname: string, from?: string | null): { active: string; breadcrumb: [string, string] } {
  if (pathname === '/') return { active: 'Dashboard', breadcrumb: ['Dashboard', 'Overview'] }
  if (pathname === '/settings') return { active: '', breadcrumb: ['My account', 'Settings'] }  // ouvert depuis le menu du compte
  const sub = SUB_PAGES.find(([pattern]) => pattern.test(pathname))?.[1]
  const origin = sub && from ? FROM_ITEM[from] : undefined
  if (origin && sub) {
    const group = navGroups.find((item) => item.items.some((link) => link.label === origin))
    if (group) return { active: origin, breadcrumb: [group.label, sub] }
  }
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`))) {
        return { active: item.label, breadcrumb: [group.label, sub ?? item.label] }
      }
    }
  }
  return { active: '', breadcrumb: ['', ''] }
}

type AppShellProps = {
  me: Me | null     // null : Django n'a pas encore répondu (le cadre s'affiche quand même, sans le nom)
  onLogout: () => void
  children: ReactNode
}

/** Les compteurs de la sidebar, relus à chaque changement de page (ex. après avoir validé une demande) :
 *  les demandes qui attendent MA réponse, et (RH) les documents à préparer. */
function useCounters(me: Me | null): Record<Counter, number> {
  const pathname = usePathname()
  const [counts, setCounts] = useState<Record<Counter, number>>({ approvals: 0, documents: 0 })
  useEffect(() => {
    if (!me) return
    const controller = new AbortController()
    const count = (path: string) => apiFetch(path, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: unknown[]) => rows.length)
    Promise.all([count('/api/workflows/approvals/'), isHr(me) ? count('/api/documents/hr/?status=to_prepare') : Promise.resolve(0)])
      .then(([approvals, documents]) => setCounts({ approvals, documents }))
      .catch(() => { /* annulé (une autre page), ou serveur injoignable : on garde les anciens nombres */ })
    return () => controller.abort()
  }, [me, pathname])
  return counts
}

// Le menu de la sidebar, avec le lien de la page actuelle surligné et les compteurs (tous deux lus avec l'adresse).
// Un composant à part, dans un <Suspense> : Next.js 16 l'exige pour lire l'adresse (usePathname, useSearchParams),
// sinon la page entière attend (erreur "Blocking Route", 2026-11-13).
function SidebarNav(props: Omit<NavListProps, 'active' | 'counts'>) {
  const counts = useCounters(props.me)
  return <NavList {...props} counts={counts} active={pageInfo(usePathname(), useSearchParams().get('from')).active} />
}

// Le fil d'Ariane du header, ex. "Management & HR > Employee file" (même raison : <Suspense>).
function Breadcrumb() {
  const [group, page] = pageInfo(usePathname(), useSearchParams().get('from')).breadcrumb
  return <div className="hidden items-center gap-2 text-sm text-slate-400 md:flex">
    <span>{group}</span><ChevronRight className="size-3.5" /><span className="font-semibold text-[#0F172A]">{page}</span>
  </div>
}

type NavListProps = {
  me: Me | null
  active: string
  collapsed: boolean        // grand écran, sidebar réduite : les icônes seulement
  counts?: Record<Counter, number>  // absent : le menu affiché en attendant l'adresse (pas encore de nombres)
  onNavigate: () => void    // téléphone : fermer la sidebar après un clic
}

function NavList({ me, active, collapsed, counts, onNavigate }: NavListProps) {
  // Ce que ce rôle a le droit de voir. Pas encore de réponse de Django : seulement les liens de tout le monde.
  const visibleGroups = navGroups
    .filter((group) => !group.restricted || (me !== null && (me.role !== 'COLLABORATOR' || me.is_superuser)))
    .map((group) => ({ ...group, items: group.items.filter((item) =>
      (!item.hrOnly || (me !== null && isHr(me))) && (!item.adminOnly || (me !== null && seesBothPoles(me)))
      && (!item.itOnly || (me !== null && me.is_superuser))
      && (!item.standInOnly || (me !== null && me.stands_in === true && me.role === 'COLLABORATOR' && !me.is_superuser))) }))
    .filter((group) => group.items.length > 0)  // une section vide (ex. Administration pour un RH) : cachée
  const [soonOpen, setSoonOpen] = useState(false)

  return <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2">
    {visibleGroups.map((group, index) => <div key={group.label}>
      {/* Le titre de la section ; réduite : une fine ligne à la place. */}
      <p className={cn('px-2.5 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500', collapsed && 'lg:hidden')}>{group.label}</p>
      {collapsed && index > 0 && <div aria-hidden className="mx-2 my-3 hidden h-px bg-white/10 lg:block" />}
      <ul className="flex flex-col gap-0.5">
        {group.items.map((item) => {
          const selected = item.label === active
          const count = item.counter && counts ? counts[item.counter] : 0
          const Icon = item.icon
          return <li key={item.label}>
            <Link href={item.href} onClick={onNavigate} aria-current={selected ? 'page' : undefined} title={collapsed ? item.label : undefined}
              className={cn('relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40',
                selected ? 'bg-white/[0.12] text-white' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
                collapsed && 'lg:justify-center lg:px-0')}>
              {/* La barre de la page actuelle, collée au bord gauche de la sidebar. */}
              {selected && <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[#8FB0FF]" />}
              <Icon className={cn('size-[18px] shrink-0', selected ? 'text-white' : 'text-slate-400')} aria-hidden />
              <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
              {count > 0 && <>
                <span className={cn('ml-auto rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-bold tabular-nums text-[#0F172A]', collapsed && 'lg:hidden')}>
                  {count > 99 ? '99+' : count}<span className="sr-only"> waiting</span>
                </span>
                {/* Réduite : un point ambre sur l'icône. */}
                {collapsed && <span aria-hidden className="absolute right-3 top-1.5 hidden size-2 rounded-full bg-amber-400 ring-2 ring-[#141f3a] lg:block" />}
              </>}
            </Link>
          </li>
        })}
      </ul>
    </div>)}

    {/* Les pages à venir : rangées, fermées au départ (on les montre sans encombrer le menu). */}
    <div className={cn('mt-5', collapsed && 'lg:hidden')}>
      <button type="button" aria-expanded={soonOpen} onClick={() => setSoonOpen((open) => !open)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-300">
        <Sparkles className="size-3.5" aria-hidden /> Coming soon
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] tracking-normal text-slate-400">{COMING_SOON.length}</span>
        <ChevronRight className={cn('ml-auto size-3.5 transition-transform', soonOpen && 'rotate-90')} aria-hidden />
      </button>
      {soonOpen && <ul className="mt-1 flex flex-col gap-0.5">
        {COMING_SOON.map(({ label, icon: Icon }) => <li key={label} aria-disabled
          className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-[13px] text-slate-500">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <span className="ml-auto rounded bg-white/5 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>
        </li>)}
      </ul>}
    </div>
  </nav>
}

// Affiché UNE fois par le layout de app/(app) : il reste en place quand on change de page.
export function AppShell({ me, onLogout, children }: AppShellProps) {
  const displayName = me ? displayNameOf(me.username) : ''
  const initials = displayName.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2)
  const [collapsed, setCollapsed] = useState(false)    // grand écran : réduite en icônes
  const [mobileOpen, setMobileOpen] = useState(false)  // téléphone : ouverte par-dessus la page
  const [query, setQuery] = useState('')
  const router = useRouter()

  // Le bouton ☰ : réduit / agrandit sur grand écran ; ouvre / ferme sur téléphone.
  function toggleNavigation() {
    if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed((old) => !old)
    else setMobileOpen((old) => !old)
  }

  function searchColleague(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const search = query.trim()
    if (!search) return
    setQuery('')
    router.push(`/directory?search=${encodeURIComponent(search)}`)  // encode : espaces, accents...
  }

  const navProps = { me, collapsed, onNavigate: () => setMobileOpen(false) }

  return <div className="min-h-screen bg-[#F1F5F9] text-[#0F172A]">
    {/* Téléphone : un fond sombre derrière la sidebar ouverte ; un clic dessus la ferme. */}
    {mobileOpen && <div aria-hidden onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[1px] lg:hidden" />}

    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-[#141f3a] text-white shadow-xl shadow-slate-900/10 transition-[width,transform] duration-200 lg:translate-x-0 lg:shadow-none',
      mobileOpen ? 'translate-x-0' : '-translate-x-full', collapsed && 'lg:w-[72px]')}>
      <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.08] px-4', collapsed && 'lg:justify-center lg:px-0')}>
        {/* Le logo ramène au tableau de bord, comme sur la plupart des sites. */}
        <Link href="/" onClick={() => setMobileOpen(false)} aria-label="Go to the dashboard" title="Dashboard"
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/40 [&_img]:h-9">
          <BrandLogo compact={collapsed} />
        </Link>
        <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden"><X className="size-5" /></button>
      </div>

      {/* fallback : le menu sans lien surligné, le temps de lire l'adresse (au premier affichage). */}
      <Suspense fallback={<NavList {...navProps} active="" />}>
        <SidebarNav {...navProps} />
      </Suspense>

      {/* Le compte : un clic ouvre le même menu que l'avatar du header (profil, mot de passe, réglages, déconnexion).
          Avant la réponse de Django : une carte grise de la même taille (rien ne "saute"). */}
      <div className={cn('shrink-0 border-t border-white/[0.08] p-3', collapsed && 'lg:px-2')}>
        {me
          ? <div className="flex items-center gap-1">
              <UserMenu me={me} displayName={displayName} onLogout={onLogout} side="top" align="start"
                triggerClassName={cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left hover:bg-white/[0.06] aria-expanded:bg-white/[0.06]', collapsed && 'lg:justify-center')}>
                <Avatar className="size-8 shrink-0 border border-white/20"><AvatarFallback className="bg-[#E4E9F2] text-[11px] font-bold text-[#192646]">{initials}</AvatarFallback></Avatar>
                <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
                  <p className="truncate text-xs font-semibold">{displayName}</p>
                  <p className="truncate text-[10px] text-slate-400">{accountLabel(me)}</p>
                </div>
                <ChevronsUpDown className={cn('size-4 shrink-0 text-slate-500', collapsed && 'lg:hidden')} aria-hidden />
              </UserMenu>
              <button type="button" onClick={onLogout} aria-label="Log out" title="Log out"
                className={cn('rounded-lg p-2 text-slate-400 hover:bg-white/[0.06] hover:text-white', collapsed && 'lg:hidden')}>
                <LogOut className="size-4" />
              </button>
            </div>
          : <div aria-hidden className="flex items-center gap-3 rounded-lg p-2">
              <div className="size-8 rounded-full bg-white/10 motion-safe:animate-pulse" />
              <div className={cn('flex-1 space-y-1.5', collapsed && 'lg:hidden')}><div className="h-2.5 w-24 rounded bg-white/10" /><div className="h-2 w-16 rounded bg-white/10" /></div>
            </div>}
      </div>
    </aside>

    <div className={cn('transition-[margin] duration-200 lg:ml-[260px]', collapsed && 'lg:ml-[72px]')}>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-5 lg:px-6">
        <button aria-label={collapsed ? 'Expand navigation' : 'Toggle navigation'} onClick={toggleNavigation}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Menu className="size-5" /></button>
        <Suspense fallback={null}>
          <Breadcrumb />
        </Suspense>
        {/* Recherche d'un collègue : Entrée -> l'annuaire, avec la recherche déjà remplie. */}
        <form role="search" onSubmit={searchColleague} className="relative ml-auto w-full max-w-[440px] lg:mx-auto">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="colleague-search" className="sr-only">Search colleagues</label>
          <Input id="colleague-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search colleagues by name, position or department..." className="h-9 border-slate-200 bg-slate-50 pl-10 text-xs shadow-none" />
        </form>
        <div className="hidden items-center gap-5 sm:flex">
          {/* La cloche : les vraies notifications (fin de période d'essai...). */}
          {me && <NotificationBell />}
          <button className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#23355d]"><CircleHelp className="size-4" /> Help</button>
          {/* L'avatar ouvre le menu du compte (profil, mot de passe, déconnexion). */}
          {me
            ? <UserMenu me={me} displayName={displayName} onLogout={onLogout}
                triggerClassName="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-[#23355d]/30">
                <Avatar className="size-9 border border-slate-200"><AvatarFallback className="bg-[#0F172A] text-xs font-bold text-white">{initials}</AvatarFallback></Avatar>
              </UserMenu>
            : <div aria-hidden className="size-9 rounded-full bg-slate-200 motion-safe:animate-pulse" />}
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
        {children}
      </main>
    </div>
  </div>
}
