'use client'

/*
 * La cloche 🔔 du header : MES notifications (ex. "La période d'essai de Karim ALAMI se termine le...",
 * "Sara Alami attend votre réponse : Congé...", "Votre demande a été acceptée : ...").
 *
 * - Chargées à l'ouverture de la page, puis à chaque ouverture de la cloche (toujours à jour).
 * - Clic sur une notification : elle devient lue, et on ouvre sa page (`link` donné par Django :
 *   la fiche, "Team approvals", "My requests"). Sans lien (une simple information) : elle devient lue.
 * - Django crée et enlève les notifications tout seul (employees/notifications.py, workflows/notify.py).
 * - Menu de Base UI, comme le menu du compte : clavier, Échap, clic dehors.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu } from '@base-ui/react/menu'
import { Bell } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

type Notification = {
  id: number
  title: string      // ex. "Fin de période d'essai"
  message: string    // calculé par Django aujourd'hui ("dans 3 jours")
  link: string | null  // la page à ouvrir au clic, ou null
  read: boolean
}

type NotificationList = { unread: number; results: Notification[] }

export function NotificationBell() {
  const [data, setData] = useState<NotificationList | null>(null)
  const [version, setVersion] = useState(0)  // +1 = recharger

  useEffect(() => {
    // AbortController : si on quitte la page avant la réponse, on annule.
    const controller = new AbortController()
    apiFetch('/api/employees/notifications/', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((list: NotificationList | null) => {
        if (list) setData(list)
      })
      .catch(() => {})  // annulé, ou serveur injoignable : la cloche reste comme elle est
    return () => controller.abort()
  }, [version])

  // Next.js garde la page en vie (cachée) : on oublie les notifications (des noms de collaborateurs).
  useEffect(() => () => setData(null), [])

  function reload() {
    setVersion((value) => value + 1)
  }

  async function markRead(id: number) {
    await apiFetch(`/api/employees/notifications/${id}/read/`, { method: 'POST' }).catch(() => {})
    reload()
  }

  async function markAllRead() {
    await apiFetch('/api/employees/notifications/read-all/', { method: 'POST' }).catch(() => {})
    reload()
  }

  const unread = data?.unread ?? 0
  const items = data?.results ?? []

  return <Menu.Root onOpenChange={(open) => { if (open) reload() }}>
    <Menu.Trigger aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 aria-expanded:bg-slate-100">
      <Bell className="size-[19px]" />
      {unread > 0 && <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-[#23355d] text-[9px] font-bold text-white ring-2 ring-white">
        {unread > 9 ? '9+' : unread}
      </span>}
    </Menu.Trigger>

    <Menu.Portal>
      <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
        <Menu.Popup className="w-[min(92vw,360px)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-900/10 outline-none">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <p className="text-sm font-semibold text-[#192646]">Notifications</p>
            {unread > 0 && <Menu.Item closeOnClick={false} onClick={markAllRead}
              className="cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold text-[#23355d] outline-none data-highlighted:bg-slate-100">
              Mark all as read
            </Menu.Item>}
          </div>
          <Menu.Separator className="my-1 h-px bg-slate-100" />

          {items.length === 0
            ? <p className="px-2.5 py-6 text-center text-xs text-slate-500">No notifications.</p>
            : <div className="max-h-[60vh] overflow-y-auto">
                {items.map((notification) => {
                  const itemClass = 'flex cursor-pointer gap-2.5 rounded-md px-2.5 py-2 outline-none data-highlighted:bg-slate-100'
                  const content = <>
                    {/* Le point bleu : pas encore lue. */}
                    <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', notification.read ? 'bg-transparent' : 'bg-[#23355d]')} />
                    <span className="min-w-0">
                      <span className={cn('block text-xs', notification.read ? 'font-medium text-slate-600' : 'font-semibold text-[#0F172A]')}>
                        {notification.title}{!notification.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{notification.message}</span>
                    </span>
                  </>
                  // Avec une page à ouvrir : un lien. Sinon (simple information) : un clic la marque comme lue.
                  return notification.link
                    ? <Menu.LinkItem key={notification.id} closeOnClick render={<Link href={notification.link} />}
                        onClick={() => markRead(notification.id)} className={itemClass}>{content}</Menu.LinkItem>
                    : <Menu.Item key={notification.id} closeOnClick={false} onClick={() => markRead(notification.id)} className={itemClass}>{content}</Menu.Item>
                })}
              </div>}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
}
