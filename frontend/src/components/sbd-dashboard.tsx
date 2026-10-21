'use client'


import { useState } from 'react'
import {
  Bell, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleHelp, ClipboardCheck, FileText, FolderOpen, Headphones, LayoutDashboard,
  LogOut, Menu, Plane, ReceiptText, Search, Settings2, ShieldCheck, UsersRound, X
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BrandLogo } from '@/components/brand-logo'
import { Input } from '@/components/ui/input'
import { FeaturedVideo } from '@/components/dashboard/featured-video'
import { Greeting } from '@/components/dashboard/greeting'
import { KpiBand } from '@/components/dashboard/kpi-band'
import { NewsPanel } from '@/components/dashboard/news-panel'
import { RequestsPanel } from '@/components/dashboard/requests-panel'
import { TimeOffPanel } from '@/components/dashboard/time-off-panel'
import { useNow } from '@/components/dashboard/time'

const navGroups = [
  { label: 'Personal Space', icon: LayoutDashboard, open: true, items: [['Dashboard', LayoutDashboard], ['Leave Requests', CalendarDays], ['Expense Claims', ReceiptText], ['Administrative Documents', FolderOpen]] },
  { label: 'Company Services', icon: Building2, items: [['Meeting Room Booking', Building2], ['Travel & Hotel', Plane], ['IT Helpdesk', Headphones]] },
  { label: 'Career & Growth', icon: BriefcaseBusiness, items: [['Training Catalog', BookOpen], ['Performance Reviews', ClipboardCheck], ['Internal Job Postings', BriefcaseBusiness]] },
  { label: 'Management & HR', icon: ShieldCheck, restricted: true, items: [['Team Approvals', Check], ['Maker-Checker Audit', ShieldCheck], ['Employee Directory', UsersRound]] },
] as const

type SbdDashboardProps = {
  username: string
  roleLabel: string
  canSeeManagement: boolean
  onLogout: () => void
}

export function SbdDashboard({ username, roleLabel, canSeeManagement, onLogout }: SbdDashboardProps) {
  // "fatima.zahra" -> "Fatima Zahra" -> "FZ"
  const displayName = username.split('.').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  const firstName = displayName.split(' ')[0]
  const initials = displayName.split(' ').map((part) => part.charAt(0)).join('').slice(0, 2)
  const visibleGroups = navGroups.filter((group) => !('restricted' in group) || canSeeManagement)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>(['Personal Space'])
  const now = useNow()

  return <div className="min-h-screen bg-[#F1F5F9] text-[#0F172A]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col bg-[#192646] text-white transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5"><BrandLogo /><button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden"><X /></button></div>
      <nav className="flex-1 overflow-y-auto px-3 py-5">{visibleGroups.map((group) => { const isExpanded = expanded.includes(group.label); const GroupIcon = group.icon; return <div key={group.label} className="mb-3"><button aria-expanded={isExpanded} onClick={() => setExpanded((current) => isExpanded ? current.filter((item) => item !== group.label) : [...current, group.label])} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${isExpanded ? 'text-white' : 'text-slate-400 hover:bg-[#5574c5] hover:text-white'}`}><GroupIcon className="size-4" /><span className="flex-1">{group.label}</span>{'restricted' in group && <ShieldCheck className="size-3.5" />}{isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>{isExpanded && <div className="mt-1 flex flex-col gap-1 pl-2">{group.items.map(([label, Icon]) => <button key={label} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${label === 'Dashboard' ? 'bg-white/15 text-white hover:bg-white/20 shadow-sm shadow-blue-950/20' : 'text-slate-300 hover:bg-[#5574c5] hover:text-white'}`}><Icon className="size-[17px] shrink-0 opacity-90" /><span className="truncate">{label}</span>{label === 'Team Approvals' && <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-[#0F172A]">2</span>}</button>)}</div>}</div> })}</nav>
      <div className="border-t border-white/10 p-4"><div className="flex items-center gap-3 rounded-lg bg-white/5 p-3"><Avatar className="size-9 border border-blue-300/40"><AvatarFallback className="bg-blue-100 text-xs font-bold text-blue-800">{initials}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{displayName}</p><p className="truncate text-[10px] text-slate-400">{roleLabel}</p></div><Settings2 className="size-4 text-slate-400" /></div><button onClick={onLogout} className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-[#5574c5] hover:text-white"><LogOut className="size-4" /> Log out</button></div>
    </aside>

    <div className={`transition-[margin] duration-200 ${sidebarOpen ? 'lg:ml-[264px]' : 'lg:ml-0'}`}>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-5 lg:px-6">
        <button aria-label="Toggle navigation" onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Menu className="size-5" /></button>
        <div className="hidden items-center gap-2 text-sm text-slate-400 md:flex"><span>Dashboard</span><ChevronRight className="size-3.5" /><span className="font-semibold text-[#0F172A]">Overview</span></div>
        <div className="relative ml-auto w-full max-w-[440px] lg:mx-auto">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search colleagues by name, email, or department..." className="h-9 border-slate-200 bg-slate-50 pl-10 text-xs shadow-none" />
          {query && <div className="absolute top-11 z-20 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><p className="text-xs font-semibold">Youssef Amrani</p><p className="text-[11px] text-slate-500">Engineering · youssef.amrani@sbd.ma</p></div>}
        </div>
        <div className="hidden items-center gap-5 sm:flex">
          <button aria-label="Notifications, 3 unread" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Bell className="size-[19px]" /><span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-[#23355d] text-[9px] font-bold text-white ring-2 ring-white">3</span></button>
          <button className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#23355d]"><CircleHelp className="size-4" /> Help</button>
          <Avatar className="size-9 border border-slate-200"><AvatarFallback className="bg-[#0F172A] text-xs font-bold text-white">{initials}</AvatarFallback></Avatar>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
        <Greeting now={now} name={firstName} />
        <KpiBand now={now} />

        {/* 12-column grid on wide screens: leadership video + news, then requests + time off.
            Two columns on tablets, one on phones. Panels in a row share a height. */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          <FeaturedVideo className="md:col-span-2 xl:col-span-7" index={2} />
          <NewsPanel className="md:col-span-2 xl:col-span-5" index={3} />
          <RequestsPanel className="md:col-span-2 xl:col-span-8" index={4} />
          <TimeOffPanel now={now} className="xl:col-span-4" index={5} />
        </div>

        <footer className="flex flex-col gap-2 border-t border-slate-200 pt-4 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>© 2026 Silent Believers Distribution</span><span className="flex items-center gap-1 font-mono"><FileText className="size-3" /> SBD-HR-PORTAL</span></footer>
      </main>
    </div>
  </div>
}

export default SbdDashboard
