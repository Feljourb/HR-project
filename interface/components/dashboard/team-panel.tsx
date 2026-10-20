import { Cake, PartyPopper, UsersRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Panel, PanelHeader } from './panel'
import { celebrations, team, type Presence } from './data'

const presence: Record<Presence, { label: string; dot: string }> = {
  office: { label: 'On site', dot: 'bg-emerald-500' },
  remote: { label: 'Remote', dot: 'bg-[#8A9CC9]' },
  leave: { label: 'On leave', dot: 'bg-slate-300' },
}

const avatarTints = ['bg-[#E4E9F2] text-[#23355d]', 'bg-[#F7F1EC] text-[#8C6D52]', 'bg-slate-100 text-slate-600']

const initials = (name: string) => {
  const parts = name.split(' ')
  return `${parts[0][0]}${parts[parts.length - 1][0]}`
}

export function TeamPanel({ className, index }: { className?: string; index: number }) {
  const count = (p: Presence) => team.filter((m) => m.presence === p).length

  return <Panel className={className} index={index}>
    <PanelHeader icon={UsersRound} title="Engineering team" meta={`${team.length} colleagues · ${count('office')} on site today`} />

    <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-600">
      {(Object.keys(presence) as Presence[]).map((p) => (
        <span key={p} className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', presence[p].dot)} /><b className="font-semibold tabular-nums text-slate-800">{count(p)}</b> {presence[p].label.toLowerCase()}</span>
      ))}
    </div>

    <ul className="flex flex-col px-2 py-1.5">
      {team.map((member, i) => (
        <li key={member.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
          <div className="relative shrink-0">
            <Avatar className="size-8"><AvatarFallback className={cn('text-[11px] font-semibold', avatarTints[i % avatarTints.length])}>{initials(member.name)}</AvatarFallback></Avatar>
            <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white', presence[member.presence].dot)} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <span className="truncate">{member.name}</span>
              {member.isNew && <span className="shrink-0 rounded-full bg-[#F7F1EC] px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-[#8C6D52] ring-1 ring-inset ring-[#D7C4B7]/70">New</span>}
            </p>
            <p className="truncate text-[11px] text-slate-500">{member.role}</p>
          </div>
          <span className={cn('shrink-0 text-[11px]', member.presence === 'leave' ? 'text-slate-400' : 'text-slate-500')}>{member.note ?? presence[member.presence].label}</span>
        </li>
      ))}
    </ul>

    <div className="mt-auto flex flex-col gap-2 border-t border-[#EDE4DC] bg-[#FBF8F5] px-4 py-3">
      {celebrations.map((c) => {
        const Icon = c.kind === 'birthday' ? Cake : PartyPopper
        return <div key={c.who} className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-[#8C6D52] ring-1 ring-[#D7C4B7]/70"><Icon className="size-3.5" /></span>
          <p className="min-w-0 flex-1 truncate text-xs text-slate-600"><b className="font-semibold text-slate-800">{c.who}</b> · {c.what}</p>
          <button type="button" className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-[#23355d] transition-colors hover:bg-white">{c.action}</button>
        </div>
      })}
    </div>
  </Panel>
}
