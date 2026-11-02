'use client'

/*
 * Les cases de chiffres (ex. Available / Taken / Pending) + "Download image" : la même bande en image PNG
 * propre, pour les présentations des RH (mieux qu'une capture d'écran : pas de menu, pas de souris,
 * un titre et la date, et nette même agrandie).
 * L'image est DESSINÉE par le navigateur (<canvas>), case par case : pas de bibliothèque en plus.
 */
import { useState } from 'react'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Tile = { label: string; value: string; hint?: string; strong?: boolean }

const COLORS = {
  page: '#F1F5F9', card: '#FFFFFF', border: '#E2E8F0', navy: '#192646',
  label: '#8C6D52', labelOnNavy: '#BFDBFE', text: '#0F172A', hint: '#64748B', hintOnNavy: '#CBD5E1',
}
const FONT = 'Inter, "Segoe UI", Arial, sans-serif'

/** Dessine le titre et les cases dans un <canvas>, puis le télécharge en PNG. */
function downloadImage(title: string, subtitle: string, tiles: Tile[], fileName: string) {
  const scale = 2  // deux fois plus de pixels : net sur un grand écran ou un projecteur
  const pad = 32, gap = 16, tileWidth = 230, tileHeight = 112, top = 96
  const width = pad * 2 + tiles.length * tileWidth + (tiles.length - 1) * gap
  const height = top + tileHeight + 52

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(scale, scale)

  // Le fond, le titre et la période.
  ctx.fillStyle = COLORS.page
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = COLORS.navy
  ctx.font = `600 22px ${FONT}`
  ctx.fillText(title, pad, 46)
  ctx.fillStyle = COLORS.hint
  ctx.font = `13px ${FONT}`
  ctx.fillText(subtitle, pad, 70)

  // Les cases, de gauche à droite.
  tiles.forEach((tile, index) => {
    const x = pad + index * (tileWidth + gap)
    ctx.beginPath()
    ctx.roundRect(x, top, tileWidth, tileHeight, 12)
    ctx.fillStyle = tile.strong ? COLORS.navy : COLORS.card
    ctx.fill()
    ctx.strokeStyle = tile.strong ? COLORS.navy : COLORS.border
    ctx.stroke()

    ctx.fillStyle = tile.strong ? COLORS.labelOnNavy : COLORS.label
    ctx.font = `600 11px ${FONT}`
    // Le dernier nombre = la largeur maximale : un texte trop long est resserré, il ne sort pas de la case.
    ctx.fillText(tile.label.toUpperCase(), x + 18, top + 28, tileWidth - 36)
    ctx.fillStyle = tile.strong ? '#FFFFFF' : COLORS.text
    ctx.font = `600 28px ${FONT}`
    ctx.fillText(tile.value, x + 18, top + 66, tileWidth - 36)
    if (tile.hint) {
      ctx.fillStyle = tile.strong ? COLORS.hintOnNavy : COLORS.hint
      ctx.font = `11px ${FONT}`
      ctx.fillText(tile.hint, x + 18, top + 90, tileWidth - 36)
    }
  })

  // En bas : d'où vient l'image et quand (utile quand on la retrouve dans une présentation).
  ctx.fillStyle = COLORS.hint
  ctx.font = `11px ${FONT}`
  ctx.fillText(`SBD Intranet · ${new Date().toLocaleDateString('fr-FR')}`, pad, height - 20)

  canvas.toBlob((blob) => {
    if (!blob) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)  // après le début du téléchargement
  }, 'image/png')
}

type StatTilesProps = {
  tiles: Tile[]
  title: string       // le titre DANS l'image, ex. "Absences — November 2026"
  subtitle: string    // ex. "Pôle SBD · approved and pending leaves"
  fileName: string    // ex. "absences_2026-11.png"
}

export function StatTiles({ tiles, title, subtitle, fileName }: StatTilesProps) {
  const [done, setDone] = useState(false)

  function download() {
    downloadImage(title, subtitle, tiles, fileName)
    setDone(true)
    setTimeout(() => setDone(false), 2000)
  }

  return <section aria-label={title} className="flex flex-col gap-2">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className={cn('rounded-xl border px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
          tile.strong ? 'border-[#23355d] bg-[#192646] text-white' : 'border-slate-200/80 bg-white')}>
          <p className={cn('text-[11px] font-semibold uppercase tracking-wide', tile.strong ? 'text-blue-200' : 'text-[#8C6D52]')}>{tile.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{tile.value}</p>
          {tile.hint && <p className={cn('text-[11px]', tile.strong ? 'text-slate-300' : 'text-slate-500')}>{tile.hint}</p>}
        </div>
      ))}
    </div>
    <button type="button" onClick={download}
      className="flex items-center gap-1.5 self-end rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white hover:text-[#192646]">
      <Download className="size-3.5" /> {done ? 'Image downloaded' : 'Download image (PNG)'}
    </button>
  </section>
}
