'use client'

import { useState } from 'react'
import { CalendarDays, ChevronRight, ClipboardList, Download, ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Panel, PanelHeader, PanelLink } from './panel'
import { requests, type RequestRow } from './data'
import { fullDate } from './time'

type Filter = 'all' | 'leave' | 'expense'

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'leave', label: 'Leave' },
  { value: 'expense', label: 'Expenses' },
]

/* base-ui marks the selected tab with `data-active` (not Radix's `data-state=active`). */
const tabTrigger = 'h-7 gap-1 rounded-md px-2.5 text-[11px] font-medium text-slate-500 data-active:bg-[#23355d] data-active:text-white data-active:shadow-sm'
const headCell = 'h-9 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400'

export function RequestsPanel({ className, index }: { className?: string; index: number }) {
  const [filter, setFilter] = useState<Filter>('all')
  const rows = filter === 'all' ? requests : requests.filter((r) => r.kind === filter)
  const count = (f: Filter) => (f === 'all' ? requests.length : requests.filter((r) => r.kind === f).length)
  const awaiting = requests.filter((r) => r.status === 'pending').length

  return <Panel className={className} index={index}>
    <PanelHeader icon={ClipboardList} title="Requests & approvals" meta={`${requests.length} recent requests · ${awaiting} awaiting approval`}>
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
        {rows.map((row) => {
          const Icon = row.kind === 'leave' ? CalendarDays : ReceiptText
          return <TableRow key={row.ref} className="border-slate-100 transition-colors hover:bg-slate-50/80">
            <TableCell className="py-2.5 pl-4">
              <div className="flex items-center gap-3">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', row.kind === 'leave' ? 'bg-[#E4E9F2] text-[#23355d]' : 'bg-[#F7F1EC] text-[#8C6D52]')}><Icon className="size-4" /></span>
                <div className="leading-tight">
                  <p className="text-[13px] font-medium text-slate-800">{row.kind === 'leave' ? 'Leave request' : 'Expense claim'}</p>
                  <p className="font-mono text-[10.5px] text-slate-400">{row.ref}</p>
                </div>
              </div>
            </TableCell>
            <TableCell className="py-2.5 text-xs text-slate-600">{row.detail}</TableCell>
            <TableCell className="py-2.5 text-xs tabular-nums text-slate-500">{fullDate(row.submitted)}</TableCell>
            <TableCell className="py-2.5 text-right text-[13px] font-semibold tabular-nums text-[#192646]">{row.amount}</TableCell>
            <TableCell className="py-2.5 pl-4"><ApprovalStatus row={row} /></TableCell>
            <TableCell className="py-2.5 pr-4 text-right">
              {row.pdf
                ? <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-md px-2 text-[11px] font-medium text-[#23355d] hover:bg-[#23355d]/10 hover:text-[#23355d]"><Download className="size-3.5" /> PDF</Button>
                : <Button variant="ghost" size="icon-sm" aria-label={`Open ${row.ref}`} className="text-slate-400 hover:bg-slate-100 hover:text-[#23355d]"><ChevronRight className="size-4" /></Button>}
            </TableCell>
          </TableRow>
        })}
      </TableBody>
    </Table>

    <PanelLink>View all requests</PanelLink>
  </Panel>
}

function ApprovalStatus({ row }: { row: RequestRow }) {
  const steps = ['Submitted', 'Manager', row.kind === 'expense' ? 'Finance' : 'HR']
  const badge = row.status === 'approved'
    ? { label: row.kind === 'expense' ? 'Reimbursed' : 'Approved', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    : row.status === 'rejected'
      ? { label: `Rejected by ${steps[row.stage].toLowerCase()}`, tone: 'border-red-200 bg-red-50 text-red-700' }
      : { label: `With ${steps[row.stage].toLowerCase()}`, tone: 'border-amber-200 bg-amber-50 text-amber-700' }

  return <div className="flex items-center gap-2.5">
    <Badge variant="outline" className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', badge.tone)}><span className="size-1.5 rounded-full bg-current" />{badge.label}</Badge>
    <div className="flex gap-0.5" role="img" aria-label={`${steps.join(', then ')}. ${row.status === 'approved' ? 'All steps complete' : `Currently at ${steps[row.stage]}`}`}>
      {steps.map((step, i) => {
        const tone = i < row.stage ? 'bg-[#23355d]'
          : i === row.stage && row.status === 'pending' ? 'bg-amber-400'
          : i === row.stage && row.status === 'rejected' ? 'bg-red-500'
          : 'bg-slate-200'
        return <span key={step} title={step} className={cn('h-1.5 w-3.5 rounded-full', tone)} />
      })}
    </div>
  </div>
}
