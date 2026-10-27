'use client'

/*
 * Le "cadre" commun à toutes les pages connectées : la barre de navigation à gauche
 * (sidebar) et la barre du haut (header). Chaque page met son contenu dedans :
 *
 *   <AppShell me={me} onLogout={logout} active="Employees" breadcrumb={[...]}>
 *     ... contenu de la page ...
 *   </AppShell>
 *
 * Avant, ce cadre était écrit à l'intérieur du tableau de bord : impossible de le
 * réutiliser pour une autre page. Le design (couleurs, tailles) n'a pas changé.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bell, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown, ChevronRight, ChevronsUpDown,
  CircleHelp, ClipboardCheck, FolderOpen, Headphones, LayoutDashboard, ListChecks, type LucideIcon,
  LogOut, Menu, Plane, ReceiptText, ScrollText, Search, ShieldCheck, UserRound, UserRoundCog, UsersRound, X,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BrandLogo } from '@/components/brand-logo'
import { Input } from '@/components/ui/input'
import { UserMenu } from '@/components/user-menu'
import { isHr, roleLabel, seesBothPoles, type Me } from '@/lib/api'

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
  ] },
]

const itemClass = 'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors'
const activeClass = 'bg-white/15 text-white hover:bg-white/20 shadow-sm shadow-blue-950/20'
const idleClass = 'text-slate-300 hover:bg-[#5574c5] hover:text-white'

/** "fatima.zahra" -> "Fatima Zahra" */
export function displayNameOf(username: string) {
  return username.split('.').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

type AppShellProps = {
  me: Me
  onLogout: () => void
  active: string                  // le lien surligné dans la sidebar, ex. "Employees"
  breadcrumb: [string, string]    // le fil d'Ariane du header, ex. ["Management & HR", "Employees"]
  children: ReactNode
}

export function AppShell({ me, onLogout, active, breadcrumb, children }: AppShellProps) {
  const displayName = displayNameOf(me.username)
  const initials = displayName.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2)

  // Ce que ce rôle a le droit de voir dans la sidebar.
  const visibleGroups = navGroups
    .filter((group) => !group.restricted || me.role !== 'COLLABORATOR' || me.is_superuser)
    .map((group) => ({ ...group, items: group.items.filter((item) =>
      (!item.hrOnly || isHr(me)) && (!item.adminOnly || seesBothPoles(me))) }))

  // Au départ, on ouvre le groupe qui contient la page active.
  const activeGroup = navGroups.find((group) => group.items.some((item) => item.label === active))?.label
  const [expanded, setExpanded] = useState<string[]>(activeGroup ? [activeGroup] : [])
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

  function toggle(label: string) {
    setExpanded((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])
  }

  return <div className="min-h-screen bg-[#F1F5F9] text-[#0F172A]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col bg-[#192646] text-white transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5">
        <BrandLogo />
        <button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden"><X /></button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
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

      <div className="border-t border-white/10 p-4">
        {/* La carte du compte : un clic ouvre le même menu que l'avatar du header (vers le haut). */}
        <UserMenu me={me} displayName={displayName} onLogout={onLogout} side="top" align="start"
          triggerClassName="flex w-full items-center gap-3 rounded-lg bg-white/5 p-3 text-left hover:bg-white/10 aria-expanded:bg-white/10">
          <Avatar className="size-9 border border-blue-300/40"><AvatarFallback className="bg-blue-100 text-xs font-bold text-blue-800">{initials}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{displayName}</p>
            <p className="truncate text-[10px] text-slate-400">{roleLabel(me.role)}</p>
          </div>
          <ChevronsUpDown className="size-4 text-slate-400" />
        </UserMenu>
        <button onClick={onLogout} className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-[#5574c5] hover:text-white"><LogOut className="size-4" /> Log out</button>
      </div>
    </aside>

    <div className={`transition-[margin] duration-200 ${sidebarOpen ? 'lg:ml-[264px]' : 'lg:ml-0'}`}>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-5 lg:px-6">
        <button aria-label="Toggle navigation" onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Menu className="size-5" /></button>
        <div className="hidden items-center gap-2 text-sm text-slate-400 md:flex">
          <span>{breadcrumb[0]}</span><ChevronRight className="size-3.5" /><span className="font-semibold text-[#0F172A]">{breadcrumb[1]}</span>
        </div>
        {/* Recherche d'un collègue : Entrée -> l'annuaire, avec la recherche déjà remplie. */}
        <form role="search" onSubmit={searchColleague} className="relative ml-auto w-full max-w-[440px] lg:mx-auto">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="colleague-search" className="sr-only">Search colleagues</label>
          <Input id="colleague-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search colleagues by name, position or department..." className="h-9 border-slate-200 bg-slate-50 pl-10 text-xs shadow-none" />
        </form>
        <div className="hidden items-center gap-5 sm:flex">
          <button aria-label="Notifications, 3 unread" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Bell className="size-[19px]" /><span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-[#23355d] text-[9px] font-bold text-white ring-2 ring-white">3</span></button>
          <button className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#23355d]"><CircleHelp className="size-4" /> Help</button>
          {/* L'avatar ouvre le menu du compte (profil, mot de passe, déconnexion). */}
          <UserMenu me={me} displayName={displayName} onLogout={onLogout}
            triggerClassName="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-[#23355d]/30">
            <Avatar className="size-9 border border-slate-200"><AvatarFallback className="bg-[#0F172A] text-xs font-bold text-white">{initials}</AvatarFallback></Avatar>
          </UserMenu>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
        {children}
      </main>
    </div>
  </div>
}
