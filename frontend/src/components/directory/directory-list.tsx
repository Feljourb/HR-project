'use client'

/*
 * L'annuaire : retrouver un collègue des deux pôles (nom, poste, service, email, téléphone).
 * Ouvert à tous les rôles. Django n'envoie que les champs publics (jamais CIN ni adresse).
 */
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Mail, Phone, RotateCw, Search, UsersRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/dashboard/panel'
import { PAGE_SIZE, type DirectoryPerson } from '@/lib/employees'
import { usePaged } from '@/lib/use-paged'
import { cn } from '@/lib/utils'

// initialSearch : la recherche tapée dans la barre du haut (ex. /directory?search=karim).
export function DirectoryList({ initialSearch = '' }: { initialSearch?: string }) {
  // Ce qu'on tape, et ce qu'on envoie à l'API 300 ms après la dernière touche.
  const [query, setQuery] = useState(initialSearch)
  const [search, setSearch] = useState(initialSearch)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = query.trim()
      if (next !== search) {
        setSearch(next)
        setPage(1)  // une nouvelle recherche repart de la page 1
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, search])

  const params = new URLSearchParams({ page: String(page) })
  if (search) params.set('search', search)
  const { data, loading, failed, retry } = usePaged<DirectoryPerson>('/api/employees/directory/', params)

  const pageCount = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return <Panel>
    <PanelHeader icon={UsersRound} title="Employee Directory" meta={data ? `${data.count} colleague${data.count === 1 ? '' : 's'} · SBD & Riaya` : 'Loading...'}>
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <label htmlFor="directory-search" className="sr-only">Search a colleague</label>
        <Input id="directory-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, position or department..." className="h-9 border-slate-200 bg-slate-50 pl-10 text-xs shadow-none" />
      </div>
    </PanelHeader>

    {!data && failed ? (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-sm text-slate-600">Could not load the directory. Please try again.</p>
        <Button variant="outline" size="sm" onClick={retry}><RotateCw /> Try again</Button>
      </div>
    ) : !data ? (
      <p className="px-4 py-12 text-center text-sm text-slate-500">Loading...</p>
    ) : (
      <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-60')}>
        {data.results.length === 0
          ? <p className="px-4 py-10 text-center text-sm text-slate-500">No colleague matches “{search}”.</p>
          : <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.results.map((person) => <PersonCard key={person.id} person={person} />)}
            </ul>}

        {/* Pagination, comme le tableau RH. */}
        <footer className="flex items-center justify-end gap-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!data.previous || loading} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
          <span className="tabular-nums">Page {page} / {pageCount}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={!data.next || loading} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
        </footer>
      </div>
    )}
  </Panel>
}

/** La carte d'un collègue : initiales, nom, poste, service, et liens pour écrire / appeler. */
function PersonCard({ person }: { person: DirectoryPerson }) {
  const initials = `${person.first_name.charAt(0)}${person.last_name.charAt(0)}`.toUpperCase()
  return <li className="flex gap-3 rounded-lg border border-slate-200/80 p-3">
    <Avatar className="size-10 shrink-0 border border-slate-200"><AvatarFallback className="bg-[#E4E9F2] text-xs font-bold text-[#23355d]">{initials}</AvatarFallback></Avatar>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[13px] font-semibold text-slate-800">{person.first_name} {person.last_name.toUpperCase()}</p>
      <p className="truncate text-xs text-slate-600">{person.position}</p>
      <p className="truncate text-[11px] text-slate-400">{person.department} · {person.direction}</p>
      {/* mailto: ouvre Outlook, tel: lance l'appel sur un téléphone. */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <a href={`mailto:${person.professional_email}`} className="flex min-w-0 items-center gap-1 text-[#23355d] hover:underline"><Mail className="size-3 shrink-0" /><span className="truncate">{person.professional_email}</span></a>
        <a href={`tel:${person.phone}`} className="flex items-center gap-1 text-[#23355d] hover:underline"><Phone className="size-3" />{person.phone}</a>
      </div>
    </div>
  </li>
}
