'use client'

/*
 * Le tableau de bord (page d'accueil). Le cadre (sidebar + header) est dans AppShell ;
 * ici il n'y a que le contenu : salutation, chiffres clés, vidéo, actualités...
 */
import { FileText } from 'lucide-react'
import { AppShell, displayNameOf } from '@/components/app-shell'
import { FeaturedVideo } from '@/components/dashboard/featured-video'
import { Greeting } from '@/components/dashboard/greeting'
import { KpiBand } from '@/components/dashboard/kpi-band'
import { NewsPanel } from '@/components/dashboard/news-panel'
import { RequestsPanel } from '@/components/dashboard/requests-panel'
import { TimeOffPanel } from '@/components/dashboard/time-off-panel'
import { useNow } from '@/components/dashboard/time'
import { isHr, type Me } from '@/lib/api'

type SbdDashboardProps = {
  me: Me
  onLogout: () => void
}

export function SbdDashboard({ me, onLogout }: SbdDashboardProps) {
  const firstName = displayNameOf(me.username).split(' ')[0]
  const now = useNow()

  return <AppShell me={me} onLogout={onLogout} active="Dashboard" breadcrumb={['Dashboard', 'Overview']}>
    <Greeting now={now} name={firstName} canAddEmployee={isHr(me)} />
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
  </AppShell>
}

export default SbdDashboard
