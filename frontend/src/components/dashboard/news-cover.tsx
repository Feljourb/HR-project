import { cn } from '@/lib/utils'
import type { NewsCoverKind } from './data'

/* Editorial covers drawn from each story's own subject instead of stock photos.
   viewBox 320×180, sliced to fill any box. Wide boxes crop top and bottom, so text stays in the
   band y 40–140; thumbnails crop the sides, so compact art stays within x 30–290. */

const display = { fontFamily: 'var(--font-instrument), ui-sans-serif, sans-serif' }
const mono = { fontFamily: 'var(--font-plex-mono), ui-monospace, monospace' }

export function NewsCover({ kind, compact = false, className }: { kind: NewsCoverKind; compact?: boolean; className?: string }) {
  return <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden className={cn('block', className)}>
    {kind === 'policy' && <PolicyArt compact={compact} />}
    {kind === 'seminar' && <SeminarArt compact={compact} />}
    {kind === 'milestone' && <MilestoneArt compact={compact} />}
    {kind === 'benefits' && <BenefitsArt compact={compact} />}
    {kind === 'logistics' && <LogisticsArt compact={compact} />}
  </svg>
}

/* Remote work: the working week, two days at home. */
function PolicyArt({ compact }: { compact: boolean }) {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI']
  const home = [1, 3]
  const x0 = compact ? 93 : 180
  return <>
    <rect width="320" height="180" fill="#192646" />
    <circle cx="300" cy="-10" r="140" fill="#23355d" />
    {!compact && <>
      <text x="22" y="126" fill="#E9D5C0" fontSize="96" fontWeight="600" style={display}>2</text>
      <text x="84" y="84" fill="#F7F1EC" fontSize="13" fontWeight="600" style={display}>home-office</text>
      <text x="84" y="100" fill="#F7F1EC" fontSize="13" fontWeight="600" style={display}>days a week</text>
      <text x="84" y="120" fill="#A9B4CC" fontSize="7.5" letterSpacing="1.2" style={mono}>FROM 1 OCT 2026</text>
    </>}
    {days.map((d, i) => {
      const x = x0 + i * 28
      const atHome = home.includes(i)
      return <g key={d}>
        <rect x={x} y="62" width="22" height="44" rx="5" fill={atHome ? '#E9D5C0' : 'none'} stroke={atHome ? 'none' : 'rgba(233,213,192,0.35)'} />
        {atHome
          ? <path d={`M${x + 5} 84l6-6 6 6v8h-12z`} fill="#192646" />
          : <rect x={x + 6} y="79" width="10" height="13" rx="1" fill="none" stroke="rgba(233,213,192,0.45)" />}
        <text x={x + 11} y="118" textAnchor="middle" fill="rgba(233,213,192,0.6)" fontSize="6.5" letterSpacing="0.4" style={mono}>{d}</text>
      </g>
    })}
  </>
}

/* Marrakech seminar: an eight-point zellige star pattern. */
function SeminarArt({ compact }: { compact: boolean }) {
  return <>
    <defs>
      <pattern id="zellige" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="scale(0.7)">
        <rect width="40" height="40" fill="#8C6D52" />
        <g transform="translate(20 20)">
          <rect x="-10" y="-10" width="20" height="20" fill="#A8845F" />
          <rect x="-10" y="-10" width="20" height="20" fill="#A8845F" transform="rotate(45)" />
          <circle r="4.5" fill="#192646" />
        </g>
        <g fill="#E9D5C0" opacity="0.55">
          <rect x="-3" y="-3" width="6" height="6" transform="rotate(45)" />
          <rect x="37" y="-3" width="6" height="6" transform="rotate(45 40 0)" />
          <rect x="-3" y="37" width="6" height="6" transform="rotate(45 0 40)" />
          <rect x="37" y="37" width="6" height="6" transform="rotate(45 40 40)" />
        </g>
      </pattern>
      <linearGradient id="seminar-fade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#192646" stopOpacity="0.92" />
        <stop offset="0.62" stopColor="#192646" stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#zellige)" />
    {!compact && <>
      <rect width="320" height="180" fill="url(#seminar-fade)" />
      <text x="22" y="98" fill="#F7F1EC" fontSize="26" fontWeight="600" style={display}>Marrakech</text>
      <text x="23" y="116" fill="#E9D5C0" fontSize="7.5" letterSpacing="1.2" style={mono}>23–24 OCT · TEAM SEMINAR</text>
    </>}
  </>
}

/* 10,000 points of sale: a field of points, some lit. */
function MilestoneArt({ compact }: { compact: boolean }) {
  const dots = []
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 20; c++) {
      const lit = (r * 7 + c * 13) % 5 === 0 || (r * 3 + c * 11) % 7 === 0
      dots.push(<circle key={`${r}-${c}`} cx={10 + c * 16} cy={14 + r * 19} r={lit ? 2.4 : 1.6} fill={lit ? '#F2C98F' : 'rgba(233,213,192,0.18)'} />)
    }
  }
  return <>
    <rect width="320" height="180" fill="#23355d" />
    {dots}
    {!compact && <>
      <rect x="16" y="56" width="168" height="68" rx="8" fill="#192646" opacity="0.94" />
      <text x="28" y="98" fill="#F7F1EC" fontSize="38" fontWeight="600" letterSpacing="-1" style={display}>10,000</text>
      <text x="29" y="113" fill="#E9D5C0" fontSize="7.5" letterSpacing="1.2" style={mono}>POINTS OF SALE · 11 REGIONS</text>
    </>}
  </>
}

/* Health insurance: a calm pulse line. */
function BenefitsArt({ compact }: { compact: boolean }) {
  return <>
    <rect width="320" height="180" fill="#E4E9F2" />
    <circle cx="258" cy="46" r="92" fill="#D5DDEA" />
    <polyline points="0,104 92,104 108,104 118,74 132,136 146,58 158,118 168,104 320,104" fill="none" stroke="#23355d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="168" cy="104" r="5" fill="#8C6D52" />
    {!compact && <text x="22" y="134" fill="#23355d" fontSize="7.5" letterSpacing="1.2" style={mono}>HEALTH COVER · FROM 1 OCT</text>}
  </>
}

/* Tangier hub: routes converging on the northern hub. */
function LogisticsArt({ compact }: { compact: boolean }) {
  const hub = { x: 92, y: 58 }
  const ends = [[300, 30], [310, 96], [280, 170], [180, 180], [40, 176], [10, 120]]
  return <>
    <rect width="320" height="180" fill="#101B35" />
    {ends.map(([x, y], i) => <path key={i} d={`M${hub.x} ${hub.y} Q${(hub.x + x) / 2 + (i % 2 ? 30 : -30)} ${(hub.y + y) / 2} ${x} ${y}`} fill="none" stroke="rgba(233,213,192,0.28)" strokeWidth="1.2" />)}
    <circle cx={hub.x} cy={hub.y} r="18" fill="none" stroke="rgba(242,201,143,0.3)" />
    <circle cx={hub.x} cy={hub.y} r="6" fill="#F2C98F" />
    {!compact && <text x={hub.x + 26} y={hub.y + 3} fill="#E9D5C0" fontSize="8.5" letterSpacing="1.5" style={mono}>TANGIER HUB</text>}
  </>
}
