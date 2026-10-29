'use client'

/*
 * Le "cadre" commun à toutes les pages connectées : la barre de navigation à gauche
 * (sidebar) et la barre du haut (header). Il est affiché une seule fois, par le layout
 * de app/(app) ; chaque page n'est que le contenu au milieu.
 * Le lien surligné et le fil d'Ariane viennent de l'adresse de la page (voir pageInfo).
 */
import { Suspense, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOpen, BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown, ChevronRight, ChevronsUpDown,
  CircleHelp, ClipboardCheck, FolderOpen, Headphones, LayoutDashboard, ListChecks, type LucideIcon,
  LogOut, Menu, Plane, ReceiptText, ScrollText, Search, ShieldCheck, UserRound, UserRoundCog, UsersRound, Workflow, X,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BrandLogo } from '@/components/brand-logo'
import { Input } from '@/components/ui/input'
import { NotificationBell } from '@/components/notification-bell'
import { UserMenu } from '@/components/user-menu'
import { accountLabel, isHr, seesBothPoles, type Me } from '@/lib/api'

type NavItem = {
  label: string
  icon: LucideIcon
  href?: string      // sans href : la page n'existe pas encore (bouton inactif)
  hrOnly?: boolean   // visible seulement pour RH et Admin RH
  adminOnly?: boolean  // visible seulement pour Admin RH (et l'IT)
}

type NavGroup = {
  label: string
  icon: LucideIcon
  restricted?: boolean  // groupe caché aux collaborateurs (managers et RH le voient)
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  { label: 'Personal Space', icon: LayoutDashboard, items: [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    { label: 'My Profile', icon: UserRound, href: '/profile' },
    { label: 'Leave Requests', icon: CalendarDays },
    { label: 'Expense Claims', icon: ReceiptText },
    { label: 'Administrative Documents', icon: FolderOpen },
  ] },
  { label: 'Company Services', icon: Building2, items: [
    // Ici (et pas dans "Management & HR") : l'annuaire est ouvert à tous les rôles.
    { label: 'Employee Directory', icon: UsersRound, href: '/directory' },
    { label: 'Meeting Room Booking', icon: Building2 },
    { label: 'Travel & Hotel', icon: Plane },
    { label: 'IT Helpdesk', icon: Headphones },
  ] },
  { label: 'Career & Growth', icon: BriefcaseBusiness, items: [
    { label: 'Training Catalog', icon: BookOpen },
    { label: 'Performance Reviews', icon: ClipboardCheck },
    { label: 'Internal Job Postings', icon: BriefcaseBusiness },
  ] },
  { label: 'Management & HR', icon: ShieldCheck, restricted: true, items: [
    { label: 'Team Approvals', icon: Check },
    { label: 'Maker-Checker Audit', icon: ShieldCheck },
    { label: 'Employees', icon: UserRoundCog, href: '/employees', hrOnly: true },
    { label: 'Audit log', icon: ScrollText, href: '/audit', hrOnly: true },
    { label: 'Reference lists', icon: ListChecks, href: '/lists', adminOnly: true },
    { label: 'Workflows', icon: Workflow, href: '/workflows', adminOnly: true },
  ] },
]

const itemClass = 'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors'
const activeClass = 'bg-white/15 text-white hover:bg-white/20 shadow-sm shadow-blue-950/20'
const idleClass = 'text-slate-300 hover:bg-[#5574c5] hover:text-white'

/** "fatima.zahra" -> "Fatima Zahra" */
export function displayNameOf(username: string) {
  return username.split('.').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

// Les sous-pages qui ne sont pas dans le menu : leur nom dans le fil d'Ariane.
const SUB_PAGES: [RegExp, string][] = [
  [/^\/employees\/new$/, 'New employee'],
  [/^\/employees\/\d+$/, 'Employee file'],
]

/**
 * Le lien surligné et le fil d'Ariane, déduits de l'adresse de la page.
 * Ex. "/employees/7" -> lien "Employees", fil "Management & HR > Employee file".
 */
function pageInfo(pathname: string): { active: string; breadcrumb: [string, string] } {
  if (pathname === '/') return { active: 'Dashboard', breadcrumb: ['Dashboard', 'Overview'] }
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href && item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`))) {
        const sub = SUB_PAGES.find(([pattern]) => pattern.test(pathname))?.[1]
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

// Le menu de la sidebar, avec le lien de la page actuelle surligné (lu dans l'adresse).
// Un composant à part, dans un <Suspense> : Next.js l'exige pour lire l'adresse (usePathname)
// sur une page avec un numéro comme /employees/7.
function SidebarNav({ me }: { me: Me | null }) {
  return <NavList me={me} active={pageInfo(usePathname()).active} />
}

// Le fil d'Ariane du header, ex. "Management & HR > Employee file" (même raison : <Suspense>).
function Breadcrumb() {
  const [group, page] = pageInfo(usePathname()).breadcrumb
  return <div className="hidden items-center gap-2 text-sm text-slate-400 md:flex">
    <span>{group}</span><ChevronRight className="size-3.5" /><span className="font-semibold text-[#0F172A]">{page}</span>
  </div>
}

function NavList({ me, active }: { me: Me | null; active: string }) {
  // Ce que ce rôle a le droit de voir dans la sidebar. Pas encore de réponse : seulement les liens
  // de tout le monde (les liens RH apparaissent quand Django a dit qui est connecté).
  const visibleGroups = navGroups
    .filter((group) => !group.restricted || (me !== null && (me.role !== 'COLLABORATOR' || me.is_superuser)))
    .map((group) => ({ ...group, items: group.items.filter((item) =>
      (!item.hrOnly || (me !== null && isHr(me))) && (!item.adminOnly || (me !== null && seesBothPoles(me)))) }))

  // On ouvre le groupe qui contient la page active : au départ, puis à chaque changement de page
  // (le cadre reste en place, donc on ajuste l'état pendant le rendu, comme le conseille React).
  const activeGroup = navGroups.find((group) => group.items.some((item) => item.label === active))?.label
  const [expanded, setExpanded] = useState<string[]>(activeGroup ? [activeGroup] : [])
  const [openedFor, setOpenedFor] = useState(activeGroup)
  if (activeGroup !== openedFor) {
    setOpenedFor(activeGroup)
    if (activeGroup && !expanded.includes(activeGroup)) setExpanded([...expanded, activeGroup])
  }

  function toggle(label: string) {
    setExpanded((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])
  }

  return <nav className="flex-1 overflow-y-auto px-3 py-5">
    {visibleGroups.map((group) => {
      const isExpanded = expanded.includes(group.label)
      const GroupIcon = group.icon
      return <div key={group.label} className="mb-3">
        <button aria-expanded={isExpanded} onClick={() => toggle(group.label)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${isExpanded ? 'text-white' : 'text-slate-400 hover:bg-[#5574c5] hover:text-white'}`}>
          <GroupIcon className="size-4" />
          <span className="flex-1">{group.label}</span>
          {group.restricted && <ShieldCheck className="size-3.5" />}
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        {isExpanded && <div className="mt-1 flex flex-col gap-1 pl-2">
          {group.items.map(({ label, icon: Icon, href }) => {
            const content = <>
              <Icon className="size-[17px] shrink-0 opacity-90" />
              <span className="truncate">{label}</span>
              {label === 'Team Approvals' && <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-[#0F172A]">2</span>}
            </>
            const className = `${itemClass} ${label === active ? activeClass : idleClass}`
            // Link : navigation Next.js sans recharger la page. Pas encore de page : simple bouton.
            return href
              ? <Link key={label} href={href} aria-current={label === active ? 'page' : undefined} className={className}>{content}</Link>
              : <button key={label} className={className}>{content}</button>
          })}
        </div>}
      </div>
    })}
  </nav>
}

// Affiché UNE fois par le layout de app/(app) : il reste en place quand on change de page.
export function AppShell({ me, onLogout, children }: AppShellProps) {
  const displayName = me ? displayNameOf(me.username) : ''
  const initials = displayName.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [query, setQuery] = useState('')
  const router = useRouter()

  function searchColleague(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const search = query.trim()
    if (!search) return
    setQuery('')
    router.push(`/directory?search=${encodeURIComponent(search)}`)  // encode : espaces, accents...
  }

  return <div className="min-h-screen bg-[#F1F5F9] text-[#0F172A]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col bg-[#192646] text-white transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5">
        <BrandLogo />
        <button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden"><X /></button>
      </div>

      {/* fallback : le menu sans lien surligné, le temps de lire l'adresse (au premier affichage). */}
      <Suspense fallback={<NavList me={me} active="" />}>
        <SidebarNav me={me} />
      </Suspense>

      <div className="border-t border-white/10 p-4">
        {/* La carte du compte : un clic ouvre le même menu que l'avatar du header (vers le haut).
            Avant la réponse de Django : une carte grise de la même taille (rien ne "saute"). */}
        {me
          ? <UserMenu me={me} displayName={displayName} onLogout={onLogout} side="top" align="start"
              triggerClassName="flex w-full items-center gap-3 rounded-lg bg-white/5 p-3 text-left hover:bg-white/10 aria-expanded:bg-white/10">
              <Avatar className="size-9 border border-blue-300/40"><AvatarFallback className="bg-blue-100 text-xs font-bold text-blue-800">{initials}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{displayName}</p>
                <p className="truncate text-[10px] text-slate-400">{accountLabel(me)}</p>
              </div>
              <ChevronsUpDown className="size-4 text-slate-400" />
            </UserMenu>
          : <div aria-hidden className="flex items-center gap-3 rounded-lg bg-white/5 p-3">
              <div className="size-9 rounded-full bg-white/10 motion-safe:animate-pulse" />
              <div className="flex-1 space-y-1.5"><div className="h-2.5 w-24 rounded bg-white/10" /><div className="h-2 w-16 rounded bg-white/10" /></div>
            </div>}
        <button onClick={onLogout} className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-[#5574c5] hover:text-white"><LogOut className="size-4" /> Log out</button>
      </div>
    </aside>

    <div className={`transition-[margin] duration-200 ${sidebarOpen ? 'lg:ml-[264px]' : 'lg:ml-0'}`}>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-5 lg:px-6">
        <button aria-label="Toggle navigation" onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Menu className="size-5" /></button>
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
