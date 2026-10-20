/* Sample data for the employee home page. Figures are kept consistent with each other:
   pending claims add up to the KPI total, leave taken + planned + free = entitlement. */

export type RequestKind = 'leave' | 'expense'
export type RequestStatus = 'approved' | 'pending' | 'rejected'

export interface RequestRow {
  ref: string
  kind: RequestKind
  submitted: string
  detail: string
  amount: string
  status: RequestStatus
  /** Index of the approval step the request is at: 0 Submitted, 1 Manager, 2 Finance/HR, 3 done. */
  stage: number
  pdf?: boolean
}

export const requests: RequestRow[] = [
  { ref: 'EXP-26-0418', kind: 'expense', submitted: '2026-09-25', detail: 'Train Casablanca – Rabat · client visit', amount: '620 MAD', status: 'pending', stage: 1 },
  { ref: 'LVE-26-0411', kind: 'leave', submitted: '2026-09-22', detail: 'Annual leave · 12–14 Oct', amount: '3 days', status: 'approved', stage: 3 },
  { ref: 'EXP-26-0405', kind: 'expense', submitted: '2026-09-18', detail: 'Client lunch · Casablanca', amount: '1,280 MAD', status: 'pending', stage: 2 },
  { ref: 'EXP-26-0397', kind: 'expense', submitted: '2026-09-11', detail: 'Work equipment · keyboard', amount: '1,550 MAD', status: 'pending', stage: 1 },
  { ref: 'EXP-26-0384', kind: 'expense', submitted: '2026-09-04', detail: 'Taxi & tram · August', amount: '460 MAD', status: 'approved', stage: 3, pdf: true },
  { ref: 'LVE-26-0371', kind: 'leave', submitted: '2026-08-27', detail: 'Personal leave · 29 Aug', amount: '1 day', status: 'rejected', stage: 1 },
  { ref: 'LVE-26-0352', kind: 'leave', submitted: '2026-08-10', detail: 'Sick leave · medical certificate', amount: '2 days', status: 'approved', stage: 3, pdf: true },
]

export const pendingExpenses = { total: 3450, claims: 3, withManager: 2, withFinance: 1 }

/** Amount claimed per month (by submission date), in MAD. */
export const expenseHistory = [
  { month: 'Apr', amount: 940 },
  { month: 'May', amount: 1620 },
  { month: 'Jun', amount: 780 },
  { month: 'Jul', amount: 2150 },
  { month: 'Aug', amount: 1310 },
  { month: 'Sep', amount: 3910 },
]

/** Moroccan Labour Code: 1.5 days accrued per month worked, 18 days a year. */
export const leave = { entitlement: 18, taken: 5.5, planned: 3, monthlyAccrual: 1.5 }

/** `acknowledges` links a task to a must-read story: acknowledging the story completes the task. */
export const tasks: { id: string; title: string; due: string; from: string; acknowledges?: string }[] = [
  { id: 'training-eval', title: 'Training evaluation · Advanced Excel', due: '2026-10-02', from: 'HR' },
  { id: 'remote-policy-ack', title: 'Acknowledge remote work policy', due: '2026-10-05', from: 'HR', acknowledges: 'remote-policy' },
  { id: 'it-charter', title: 'Sign IT charter v3', due: '2026-10-05', from: 'IT' },
]

export interface AgendaItem {
  start: string
  end: string
  title: string
  place: string
  people: string
  online?: boolean
}

export const agenda: AgendaItem[] = [
  { start: '09:30', end: '09:45', title: 'Daily stand-up', place: 'Teams', people: 'Engineering squad', online: true },
  { start: '11:00', end: '11:30', title: '1:1 with Youssef Amrani', place: 'Room Atlas', people: 'Manager' },
  { start: '14:00', end: '15:00', title: 'Cybersecurity awareness', place: 'Auditorium', people: 'Mandatory training' },
  { start: '15:30', end: '16:00', title: 'Welcome coffee with Salma', place: 'Café, ground floor', people: 'New joiner' },
  { start: '16:30', end: '17:15', title: 'Sprint 40 review', place: 'Room Toubkal', people: '8 attendees' },
]

export const weekLoad = [
  { day: 'Mon', hours: 3 },
  { day: 'Tue', hours: 1.5 },
  { day: 'Wed', hours: 2.75 },
  { day: 'Thu', hours: 4 },
  { day: 'Fri', hours: 1 },
]

export type TimeOffKind = 'leave' | 'holiday' | 'event'

export const timeOff: { from: string; to: string; kind: TimeOffKind; title: string; meta: string }[] = [
  { from: '2026-10-02', to: '2026-10-02', kind: 'event', title: 'Seminar registration closes', meta: 'Annual Team Seminar' },
  { from: '2026-10-08', to: '2026-10-08', kind: 'event', title: 'Q4 Town Hall', meta: '10:00 · Main auditorium' },
  { from: '2026-10-12', to: '2026-10-14', kind: 'leave', title: 'Annual leave', meta: '3 days · Approved' },
  { from: '2026-11-06', to: '2026-11-06', kind: 'holiday', title: 'Green March Day', meta: 'Office closed' },
  { from: '2026-11-18', to: '2026-11-18', kind: 'holiday', title: 'Independence Day', meta: 'Office closed' },
]

export type Presence = 'office' | 'remote' | 'leave'

export const team: { name: string; role: string; presence: Presence; note?: string; isNew?: boolean }[] = [
  { name: 'Youssef Amrani', role: 'Engineering Manager', presence: 'office' },
  { name: 'Salma Bennani', role: 'Frontend Developer', presence: 'office', isNew: true },
  { name: 'Karim El Idrissi', role: 'Backend Developer', presence: 'remote' },
  { name: 'Nadia Ouazzani', role: 'QA Engineer', presence: 'office' },
  { name: 'Omar Tazi', role: 'DevOps Engineer', presence: 'leave', note: 'Back 2 Oct' },
  { name: 'Imane Chraibi', role: 'Product Designer', presence: 'remote' },
  { name: 'Hamza Berrada', role: 'Data Analyst', presence: 'office' },
]

export const celebrations = [
  { kind: 'birthday', who: 'Nadia Ouazzani', what: 'birthday today', action: 'Send wishes' },
  { kind: 'anniversary', who: 'Karim El Idrissi', what: '3 years at SBD', action: 'Congratulate' },
] as const

export type ReactionKey = 'like' | 'celebrate' | 'insightful' | 'support'
export type NewsCoverKind = 'policy' | 'seminar' | 'milestone' | 'benefits' | 'logistics'

export interface NewsItem {
  id: string
  cover: NewsCoverKind
  category: string
  date: string
  title: string
  excerpt: string
  author: string
  readMinutes: number
  views: number
  comments: number
  reactions: Record<ReactionKey, number>
  unread?: boolean
  featured?: boolean
  mustRead?: { due: string }
}

/* Featured stories rotate in this order in the top-story carousel. */
export const news: NewsItem[] = [
  {
    id: 'remote-policy', cover: 'policy', category: 'HR policy', date: '2026-09-21', featured: true, unread: true, mustRead: { due: '2026-10-05' },
    title: 'Remote work: two home-office days per week from 1 October',
    excerpt: 'Choose your two days with your manager each month. Core hours stay 10:00–16:00, and warehouse teams keep their current rota.',
    author: 'Human Resources', readMinutes: 3, views: 1034, comments: 41, reactions: { like: 148, celebrate: 71, insightful: 22, support: 15 },
  },
  {
    id: 'seminar-2026', cover: 'seminar', category: 'Events', date: '2026-09-24', featured: true, unread: true,
    title: 'Annual Team Seminar in Marrakech: register by 2 October',
    excerpt: 'Two days of workshops, team challenges and the 2027 roadmap on 23–24 October. Transport from Casablanca and Tangier is included.',
    author: 'Internal Communications', readMinutes: 2, views: 912, comments: 24, reactions: { like: 96, celebrate: 64, insightful: 9, support: 19 },
  },
  {
    id: 'pos-10000', cover: 'milestone', category: 'Company', date: '2026-09-15', featured: true,
    title: 'SBD network passes 10,000 points of sale nationwide',
    excerpt: 'Our retail network now covers 11 regions. Oujda and Laâyoune are among the fastest-growing areas this year.',
    author: 'General Management', readMinutes: 1, views: 1310, comments: 57, reactions: { like: 188, celebrate: 164, insightful: 31, support: 19 },
  },
  {
    id: 'health-insurance', cover: 'benefits', category: 'Benefits', date: '2026-09-08',
    title: 'New health insurance partner from 1 October',
    excerpt: 'Better reimbursement on optical and dental care, and a mobile app for claims.',
    author: 'Human Resources', readMinutes: 2, views: 876, comments: 12, reactions: { like: 61, celebrate: 18, insightful: 12, support: 4 },
  },
  {
    id: 'tangier-hub', cover: 'logistics', category: 'Operations', date: '2026-09-02',
    title: 'Tangier logistics hub begins operations',
    excerpt: 'The new hub serves the north region and cuts average delivery time to Tétouan and Al Hoceïma.',
    author: 'Operations', readMinutes: 2, views: 654, comments: 9, reactions: { like: 77, celebrate: 38, insightful: 11, support: 5 },
  },
]

export interface Cue { start: number; end: number; text: string }

export const featuredVideo = {
  id: 'dg-q4-2026',
  eyebrow: 'Message from General Management',
  title: 'Q4 2026: our priorities and the year ahead',
  summary: 'Q3 results, the three priorities for the last quarter (service, the retailer ordering app, our people) and an invitation to send questions for the Town Hall.',
  speaker: 'General Management',
  organisation: 'Silent Believers Distribution',
  published: '2026-09-26',
  duration: 134,
  /* Drop the real file at public/videos/message-dg-q4-2026.mp4. Captions are generated from `transcript`. */
  src: '/videos/message-dg-q4-2026.mp4',
  views: 1248,
  comments: 37,
  reactions: { like: 214, celebrate: 96, insightful: 58, support: 41 } as Record<ReactionKey, number>,
  chapters: [
    { start: 0, title: 'Welcome' },
    { start: 18, title: 'Q3 in review' },
    { start: 52, title: 'Our Q4 priorities' },
    { start: 104, title: 'Town Hall & thanks' },
  ],
  transcript: {
    en: [
      { start: 0, end: 6, text: 'Hello everyone, and thank you for taking two minutes with us.' },
      { start: 6, end: 12, text: 'As we close the third quarter, we want to share where we stand and where we are going.' },
      { start: 12, end: 18, text: 'Every order that reaches a shop on time starts with one of you.' },
      { start: 18, end: 26, text: 'This summer our network passed ten thousand points of sale across the country.' },
      { start: 26, end: 34, text: 'The new Tangier hub started operations, bringing the north closer to our customers.' },
      { start: 34, end: 43, text: 'On-time delivery reached ninety-six percent, even through the August peak.' },
      { start: 43, end: 52, text: 'These results belong to the warehouse teams, the drivers, the sales force and every support function.' },
      { start: 52, end: 62, text: 'For the fourth quarter we are focusing on three priorities.' },
      { start: 62, end: 72, text: 'First, service: ninety-eight percent on-time delivery in every region.' },
      { start: 72, end: 83, text: 'Second, the retailer ordering app, which will reach all regions by December.' },
      { start: 83, end: 94, text: 'Third, our people: more training hours, and two home-office days a week for office roles.' },
      { start: 94, end: 104, text: 'Safety on the road and in the warehouse remains non-negotiable.' },
      { start: 104, end: 114, text: 'We will go into detail at the Q4 Town Hall on the 8th of October.' },
      { start: 114, end: 124, text: 'Send us your questions before then. We will answer as many as we can, anonymous ones included.' },
      { start: 124, end: 134, text: 'Thank you for your commitment. See you in Marrakech for the seminar.' },
    ],
    fr: [
      { start: 0, end: 6, text: 'Bonjour à toutes et à tous, et merci de nous accorder deux minutes.' },
      { start: 6, end: 12, text: 'Alors que nous clôturons le troisième trimestre, nous voulons partager où nous en sommes et où nous allons.' },
      { start: 12, end: 18, text: 'Chaque commande livrée à l’heure en magasin commence par l’un d’entre vous.' },
      { start: 18, end: 26, text: 'Cet été, notre réseau a dépassé dix mille points de vente dans tout le pays.' },
      { start: 26, end: 34, text: 'Le nouveau hub de Tanger a démarré, rapprochant le Nord de nos clients.' },
      { start: 34, end: 43, text: 'Le taux de livraison à l’heure a atteint quatre-vingt-seize pour cent, malgré le pic d’août.' },
      { start: 43, end: 52, text: 'Ces résultats appartiennent aux équipes d’entrepôt, aux chauffeurs, à la force de vente et à toutes les fonctions support.' },
      { start: 52, end: 62, text: 'Pour le quatrième trimestre, nous nous concentrons sur trois priorités.' },
      { start: 62, end: 72, text: 'D’abord le service : quatre-vingt-dix-huit pour cent de livraisons à l’heure dans chaque région.' },
      { start: 72, end: 83, text: 'Ensuite l’application de commande pour les détaillants, déployée dans toutes les régions d’ici décembre.' },
      { start: 83, end: 94, text: 'Enfin nos équipes : plus d’heures de formation, et deux jours de télétravail par semaine pour les fonctions de bureau.' },
      { start: 94, end: 104, text: 'La sécurité sur la route et en entrepôt reste non négociable.' },
      { start: 104, end: 114, text: 'Nous entrerons dans le détail lors du Town Hall du 8 octobre.' },
      { start: 114, end: 124, text: 'Envoyez-nous vos questions d’ici là. Nous répondrons au plus grand nombre, y compris aux questions anonymes.' },
      { start: 124, end: 134, text: 'Merci pour votre engagement. Rendez-vous à Marrakech pour le séminaire.' },
    ],
  } satisfies Record<'en' | 'fr', Cue[]>,
}

export const townHall = {
  date: '2026-10-08',
  time: '10:00',
  place: 'Main auditorium & Teams',
  questions: [
    { id: 'q1', text: 'Will the Tangier hub change delivery routes for the north region?', author: 'Hamza Berrada · Data', askedAt: '2026-09-26', votes: 42 },
    { id: 'q2', text: 'How will the two home-office days be coordinated across a team?', author: 'Anonymous', askedAt: '2026-09-27', votes: 38 },
    { id: 'q3', text: 'Is the retailer ordering app planned for the southern regions too?', author: 'Nadia Ouazzani · QA', askedAt: '2026-09-26', votes: 27 },
    { id: 'q4', text: 'Can interns take part in the Marrakech seminar?', author: 'Anonymous', askedAt: '2026-09-28', votes: 19 },
  ],
}
