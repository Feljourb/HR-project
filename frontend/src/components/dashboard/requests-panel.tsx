'use client'

/*
 * "Requests & approvals" : MES dernières demandes de congé et notes de frais (les vraies, avant : des exemples),
 * avec où elles en sont dans leur circuit. Une ligne ouvre la demande ; une note validée a son PDF.
 */
import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronRight, ClipboardList, ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatMad, type ExpenseClaim } from '@/lib/expenses'
import { formatDate, formatDays } from '@/lib/leaves'
import { cn } from '@/lib/utils'
import { PdfButton } from '@/components/expenses/claim-actions'
import { Panel, PanelHeader, PanelLink } from './panel'
import { fullDate } from './time'
import type { LeaveData } from './use-leave-data'

type Kind = 'leave' | 'expense'
type Filter = 'all' | Kind

// Une ligne du tableau, faite à partir d'un congé ou d'une note de frais.
type Row = {
  key: string; kind: Kind; ref: string; detail: string; submitted: string; amount: string
  status: string; reimbursed: boolean; waitingFor: string | null; href: string; claim?: ExpenseClaim
}

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'leave', label: 'Leave' },
  { value: 'expense', label: 'Expenses' },
]

/* base-ui marks the selected tab with `data-active` (not Radix's `data-state=active`). */
const tabTrigger = 'h-7 gap-1 rounded-md px-2.5 text-[11px] font-medium text-slate-500 data-active:bg-[#23355d] data-active:text-white data-active:shadow-sm'
const headCell = 'h-9 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400'

function rowsOf(leaveData: LeaveData | null, claims: ExpenseClaim[]): Row[] {
  const leaves: Row[] = (leaveData?.leaves ?? []).map((leave) => ({
    key: `leave-${leave.id}`, kind: 'leave', ref: `N° ${leave.request}`,
    detail: `${leave.leave_type_label} · ${formatDate(leave.start_date)} – ${formatDate(leave.end_date)}`,
    submitted: leave.created_at.slice(0, 10), amount: formatDays(leave.days), status: leave.status,
    reimbursed: false, waitingFor: null, href: `/requests/${leave.request}?from=dashboard`,
  }))
  const expenses: Row[] = claims.map((claim) => ({
    key: `expense-${claim.id}`, kind: 'expense', ref: `N° ${claim.request}`, detail: claim.title,
    submitted: claim.created_at.slice(0, 10), amount: formatMad(claim.total), status: claim.status,
    reimbursed: Boolean(claim.reimbursed_at), waitingFor: claim.waiting_for, href: `/expenses/${claim.request}?from=dashboard`, claim,
  }))
  // Les plus récentes d'abord, 6 au plus (la case reste petite ; "View all requests" pour le reste).
  return [...leaves, ...expenses].sort((a, b) => b.submitted.localeCompare(a.submitted) || b.ref.localeCompare(a.ref)).slice(0, 6)
}

export function RequestsPanel({ leaveData, claims, className, index }: {
  leaveData: LeaveData | 'none' | null; claims: ExpenseClaim[] | null; className?: string; index: number
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const all = rowsOf(leaveData && leaveData !== 'none' ? leaveData : null, claims ?? [])
  const rows = filter === 'all' ? all : all.filter((r) => r.kind === filter)
  const count = (f: Filter) => (f === 'all' ? all.length : all.filter((r) => r.kind === f).length)
  const awaiting = all.filter((r) => r.status === 'IN_PROGRESS').length

  return <Panel className={className} index={index}>
    <PanelHeader icon={ClipboardList} title="Requests & approvals" meta={`${all.length} recent requests · ${awaiting} awaiting approval`}>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList className="h-8 rounded-lg bg-slate-100 p-0.5">
          {filters.map((f) => <TabsTrigger key={f.value} value={f.value} className={tabTrigger}>{f.label}<span className="tabular-nums opacity-60">{count(f.value)}</span></TabsTrigger>)}
        </TabsList>
      </Tabs>
    </PanelHeader>

    <Table>
      <TableHeader>
        <TableRow className="border-slate-100 bg-slate-50/80 hover:bg-slate-50/80">
          <TableHead className={cn(headCell, 'pl-4')}>Request</TableHead>
          <TableHead className={headCell}>Details</TableHead>
          <TableHead className={headCell}>Submitted</TableHead>
          <TableHead className={cn(headCell, 'text-right')}>Amount</TableHead>
          <TableHead className={cn(headCell, 'pl-4')}>Approval</TableHead>
          <TableHead className={cn(headCell, 'pr-4 text-right')}><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-xs text-slate-500">
          {leaveData === null || claims === null ? 'Loading...' : 'No request yet: use Request leave or Submit expense.'}
        </TableCell></TableRow>}
        {rows.map((row) => {
          const Icon = row.kind === 'leave' ? CalendarDays : ReceiptText
          return <TableRow key={row.key} className="border-slate-100 transition-colors hover:bg-slate-50/80">
            <TableCell className="py-2.5 pl-4">
              <div className="flex items-center gap-3">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', row.kind === 'leave' ? 'bg-[#E4E9F2] text-[#23355d]' : 'bg-[#F7F1EC] text-[#8C6D52]')}><Icon className="size-4" /></span>
                <div className="leading-tight">
                  <p className="text-[13px] font-medium text-slate-800">{row.kind === 'leave' ? 'Leave request' : 'Expense claim'}</p>
                  <p className="font-mono text-[10.5px] text-slate-400">{row.ref}</p>
                </div>
              </div>
            </TableCell>
            <TableCell className="max-w-56 truncate py-2.5 text-xs text-slate-600">{row.detail}</TableCell>
            <TableCell className="py-2.5 text-xs tabular-nums text-slate-500">{fullDate(row.submitted)}</TableCell>
            <TableCell className="py-2.5 text-right text-[13px] font-semibold tabular-nums text-[#192646]">{row.amount}</TableCell>
            <TableCell className="py-2.5 pl-4"><ApprovalStatus row={row} /></TableCell>
            <TableCell className="py-2.5 pr-4 text-right">
              <div className="flex items-center justify-end gap-1">
                {row.claim && <PdfButton claim={row.claim} />}
                <Link href={row.href} aria-label={`Open ${row.ref}`} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#23355d]"><ChevronRight className="size-4" /></Link>
              </div>
            </TableCell>
          </TableRow>
        })}
      </TableBody>
    </Table>

    <PanelLink href="/requests">View all requests</PanelLink>
  </Panel>
}

// Le badge et les 3 petits traits : envoyée -> N+1 -> terminée.
function ApprovalStatus({ row }: { row: Row }) {
  const stage = row.status === 'IN_PROGRESS' ? 1 : row.status === 'REJECTED' ? 1 : row.status === 'CANCELLED' ? 0 : 3
  const badge = row.status === 'APPROVED'
    ? { label: row.reimbursed ? 'Reimbursed' : 'Approved', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    : row.status === 'REJECTED'
      ? { label: 'Rejected', tone: 'border-red-200 bg-red-50 text-red-700' }
      : row.status === 'CANCELLED'
        ? { label: 'Cancelled', tone: 'border-slate-200 bg-slate-50 text-slate-500' }
        : { label: row.waitingFor ? `With ${row.waitingFor}` : 'In approval', tone: 'border-amber-200 bg-amber-50 text-amber-700' }
  const steps = ['Submitted', 'N+1', 'Done']

  return <div className="flex items-center gap-2.5">
    <Badge variant="outline" className={cn('max-w-48 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold', badge.tone)}><span className="size-1.5 shrink-0 rounded-full bg-current" />{badge.label}</Badge>
    <div className="flex gap-0.5" role="img" aria-label={`${steps.join(', then ')}. ${badge.label}`}>
      {steps.map((step, i) => {
        const tone = i < stage ? 'bg-[#23355d]'
          : i === stage && row.status === 'IN_PROGRESS' ? 'bg-amber-400'
          : i === stage && row.status === 'REJECTED' ? 'bg-red-500'
          : 'bg-slate-200'
        return <span key={step} title={step} className={cn('h-1.5 w-3.5 rounded-full', tone)} />
      })}
    </div>
  </div>
}
