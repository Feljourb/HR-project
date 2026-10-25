'use client'

/*
 * Le formulaire d'un collaborateur : CRÉER (sans employeeId) ou MODIFIER (avec employeeId).
 *
 * Organisation en CASCADE : Entité -> Direction -> Service -> Poste.
 * Chaque liste ne montre que les enfants du choix précédent, et changer un niveau
 * vide les niveaux en dessous. On n'envoie à l'API que le service et le poste :
 * Django retrouve la direction, l'entité et le pôle tout seul (voir le modèle Employee).
 *
 * Les règles (poste du bon service, pôle du RH, CIN unique...) sont vérifiées par
 * Django : on affiche simplement ses messages d'erreur sous chaque champ.
 */
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { apiFetch, seesBothPoles, type Me } from '@/lib/api'
import {
  FORM_FIELDS, MARITAL_LABELS, STATUS_LABELS, TITLE_LABELS,
  type EmployeeFiche, type FormField, type ReferenceItem,
} from '@/lib/employees'
import { AddValueDialog, type AddRequest } from './add-value-dialog'
import { FormSection, SelectField, TextField } from './form-fields'
import { ManagerPicker } from './manager-picker'
import { useList } from './use-list'

type Values = Record<FormField, string>
type Errors = Record<string, string[]>

// Un formulaire vide (valeurs par défaut comme dans le modèle Django).
const EMPTY: Values = {
  ...(Object.fromEntries(FORM_FIELDS.map((name) => [name, ''])) as Values),
  country: 'Maroc',
  status: 'ACTIVE',
  initial_leave_balance: '0',
}

// Les choix fixes, au format des listes déroulantes.
const toOptions = (labels: Record<string, string>) => Object.entries(labels).map(([id, name]) => ({ id, name }))
const TITLE_OPTIONS = toOptions(TITLE_LABELS)
const MARITAL_OPTIONS = toOptions(MARITAL_LABELS)
const STATUS_OPTIONS = toOptions(STATUS_LABELS)

// Le rôle du compte créé. Seuls Admin RH / IT peuvent donner un rôle RH (Django vérifie aussi).
const BASE_ROLES = [{ id: 'COLLABORATOR', name: 'Collaborateur' }, { id: 'MANAGER', name: 'Manager' }]
const HR_ROLES = [{ id: 'HR', name: 'RH' }, { id: 'HR_ADMIN', name: 'Admin RH' }]

/** Le dossier reçu de l'API -> les valeurs du formulaire (tout en texte, '' si vide). */
function valuesOf(fiche: EmployeeFiche): Values {
  return Object.fromEntries(FORM_FIELDS.map((name) => [name, fiche[name] == null ? '' : String(fiche[name])])) as Values
}

export function EmployeeForm({ me, employeeId }: { me: Me; employeeId?: number }) {
  const isEdit = employeeId !== undefined

  const [values, setValues] = useState<Values>(EMPTY)
  // Entité et direction : seulement pour filtrer les listes (jamais envoyées à l'API).
  const [entity, setEntity] = useState('')
  const [direction, setDirection] = useState('')
  const [managerLabel, setManagerLabel] = useState('')
  const [role, setRole] = useState('COLLABORATOR')

  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [created, setCreated] = useState<EmployeeFiche | null>(null)  // écran "compte créé"
  const [fiche, setFiche] = useState<EmployeeFiche | null>(null)       // le dossier chargé (modification)
  const [loadError, setLoadError] = useState('')

  // --- Les listes déroulantes (la cascade suit les choix) ---
  const poles = useList('poles')                                    // pour "+ Ajouter" une entité
  const entities = useList('entities')                              // un RH : seulement son pôle
  const directions = useList('directions', 'entity', entity)
  const departments = useList('departments', 'direction', direction)
  const positions = useList('positions', 'department', values.department)
  const contractTypes = useList('contract-types')
  const tempAgencies = useList('temp-agencies')
  const categories = useList('categories')
  const grades = useList('grades')
  const divisions = useList('divisions')
  const assignments = useList('assignments')
  const regions = useList('regions')
  const costCenters = useList('cost-centers')

  // L'agence d'intérim n'apparaît que pour un contrat "Intérimaire" (règle du modèle).
  const contractName = contractTypes.items.find((item) => String(item.id) === values.contract_type)?.name ?? ''
  const isInterim = contractName.toLowerCase() === 'intérimaire'

  // --- "+ Ajouter…" : seulement Admin RH et IT (Django refuse les autres de toute façon) ---
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null)
  const canAdd = seesBothPoles(me)

  // Le nom d'une valeur déjà choisie (pour afficher "Dans : Challenge" dans le cadre).
  const nameOf = (list: { items: ReferenceItem[] }, id: string) => list.items.find((item) => String(item.id) === id)?.name ?? ''

  /**
   * Prépare l'option "+ Ajouter…" d'une liste déroulante.
   * À la création, la nouvelle valeur est ajoutée à la liste (list.add) puis choisie (select).
   * Renvoie undefined pour un RH : l'option n'apparaît pas.
   */
  function adder(list: { add: (item: ReferenceItem) => void }, select: (id: string) => void,
    request: Omit<AddRequest, 'onCreated'>) {
    if (!canAdd) return undefined
    return () => setAddRequest({
      ...request,
      onCreated: (item) => {
        list.add(item)
        select(String(item.id))
      },
    })
  }

  // Modification : on charge le dossier, puis on remplit le formulaire.
  useEffect(() => {
    if (employeeId === undefined) return
    apiFetch(`/api/employees/${employeeId}/`)
      .then(async (response) => {
        if (!response.ok) {
          // 404 : le dossier n'existe pas, ou il est dans l'autre pôle (Django ne dit pas lequel).
          setLoadError(response.status === 404 ? 'This employee does not exist or is not in your pôle.' : 'Could not load this employee.')
          return
        }
        const data: EmployeeFiche = await response.json()
        setFiche(data)
        setValues(valuesOf(data))
        setEntity(String(data.entity))       // pour que la cascade affiche les bonnes listes
        setDirection(String(data.direction))
        setManagerLabel(data.manager_label ?? '')
      })
      .catch(() => setLoadError('Cannot reach the server. Please try again later.'))
  }, [employeeId])

  // Next.js garde la page en vie (cachée) : on vide le formulaire (CIN, adresse...) quand on la quitte.
  useEffect(() => () => reset(), [])

  function reset() {
    setValues(EMPTY)
    setEntity('')
    setDirection('')
    setManagerLabel('')
    setRole('COLLABORATOR')
    setErrors({})
    setSaving(false)
    setSavedMessage('')
    setCreated(null)
    setFiche(null)
    setLoadError('')
    setAddRequest(null)
  }

  // Change un champ, et efface son ancienne erreur.
  function set(name: FormField, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: [] }))
    setSavedMessage('')
  }

  // La cascade : changer un niveau vide les niveaux en dessous.
  function changeEntity(value: string) {
    setEntity(value)
    setDirection('')
    setValues((current) => ({ ...current, department: '', position: '' }))
  }

  function changeDirection(value: string) {
    setDirection(value)
    setValues((current) => ({ ...current, department: '', position: '' }))
  }

  function changeDepartment(value: string) {
    setValues((current) => ({ ...current, department: value, position: '' }))
    setErrors((current) => ({ ...current, department: [], position: [] }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    setSavedMessage('')

    // Ce qu'on envoie : '' devient null (champ optionnel vide).
    const body: Record<string, string | null> = {}
    for (const name of FORM_FIELDS) body[name] = values[name] === '' ? null : values[name]
    if (!isInterim) body.temp_agency = null  // pas d'agence hors contrat Intérimaire
    if (!isEdit) body.role = role

    try {
      const response = await apiFetch(isEdit ? `/api/employees/${employeeId}/` : '/api/employees/', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        if (isEdit) {
          setFiche(data)
          setValues(valuesOf(data))
          setSavedMessage('Changes saved.')
        } else {
          setCreated(data)  // affiche l'écran "compte créé"
        }
      } else if (response.status === 400) {
        // Django renvoie {"champ": ["message"]} : chaque message s'affiche sous son champ.
        setErrors(data)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setErrors({ non_field_errors: ['Something went wrong. Please try again.'] })
      }
    } catch {
      setErrors({ non_field_errors: ['Cannot reach the server. Please try again later.'] })
    }
    setSaving(false)
  }

  const error = (name: string) => errors[name]?.[0]

  // --- Écran 1 : le dossier n'a pas pu être chargé ---
  if (loadError) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
      <p className="text-sm text-slate-600">{loadError}</p>
      <Link href="/employees" className="mt-3 inline-block text-xs font-semibold text-[#23355d] hover:underline">Back to the list</Link>
    </div>
  }

  // --- Écran 2 : chargement du dossier ---
  if (isEdit && fiche === null) {
    return <p className="py-12 text-center text-sm text-slate-500">Loading...</p>
  }

  // --- Écran 3 : le collaborateur vient d'être créé ---
  if (created) {
    return <div className="mx-auto w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
      <h2 className="mt-3 text-base font-semibold text-[#192646]">Employee created</h2>
      <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-4 text-left text-sm ring-1 ring-slate-200">
        <div className="flex justify-between gap-4"><dt className="text-slate-500">ID</dt><dd className="font-mono font-semibold">{created.u_number}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Username</dt><dd className="font-mono font-semibold">{created.username}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Temporary password</dt><dd className="font-semibold">their CIN ({String(created.cin)})</dd></div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">They will be asked to choose a new password at their first sign-in.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href={`/employees/${created.id}`} className="rounded-lg bg-[#23355d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#192646]">Open the file</Link>
        <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[#23355d]/30">Add another employee</button>
        <Link href="/employees" className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-500 hover:text-[#23355d]">Back to the list</Link>
      </div>
    </div>
  }

  // --- Écran 4 : le formulaire ---
  // Le cadre "+ Ajouter" est EN DEHORS du <form> : un formulaire dans un formulaire
  // est interdit en HTML (son bouton Enregistrer enverrait le grand formulaire).
  return <>
  <AddValueDialog request={addRequest} onClose={() => setAddRequest(null)} />
  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
    {/* En-tête : titre, et matricule / username en modification. */}
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/employees" aria-label="Back to the list" className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-[#23355d]"><ArrowLeft className="size-4" /></Link>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-[#192646]">{isEdit ? `${values.first_name} ${values.last_name.toUpperCase()}` : 'New employee'}</h1>
        <p className="text-xs text-slate-500">
          {isEdit && fiche ? <><span className="font-mono">{fiche.u_number}</span> · {fiche.username}</> : 'The login account (firstname.lastname, CIN as temporary password) is created automatically.'}
        </p>
      </div>
    </div>

    {/* Les erreurs qui ne concernent aucun champ précis. */}
    {error('non_field_errors') && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error('non_field_errors')}</p>}
    {!error('non_field_errors') && Object.keys(errors).some((name) => error(name)) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">Please correct the fields in red.</p>}

    <FormSection title="Identity">
      <SelectField id="title" label="Title" required value={values.title} onChange={(v) => set('title', v)} options={TITLE_OPTIONS} error={error('title')} />
      <TextField id="last_name" label="Last name" required value={values.last_name} onChange={(v) => set('last_name', v)} error={error('last_name')} />
      <TextField id="first_name" label="First name" required value={values.first_name} onChange={(v) => set('first_name', v)} error={error('first_name')} />
      <TextField id="birth_date" label="Birth date" type="date" required value={values.birth_date} onChange={(v) => set('birth_date', v)} error={error('birth_date')} />
      <TextField id="cin" label="CIN" required value={values.cin} onChange={(v) => set('cin', v)} error={error('cin')} placeholder="AB123456" hint={isEdit ? undefined : 'Also the temporary password.'} />
      <SelectField id="marital_status" label="Marital status" required value={values.marital_status} onChange={(v) => set('marital_status', v)} options={MARITAL_OPTIONS} error={error('marital_status')} />
      <TextField id="phone" label="Phone" type="tel" required value={values.phone} onChange={(v) => set('phone', v)} error={error('phone')} placeholder="0600000000" />
      <TextField id="professional_email" label="Professional email" type="email" required value={values.professional_email} onChange={(v) => set('professional_email', v)} error={error('professional_email')} placeholder="firstname.lastname@sbd.ma" />
      <TextField id="address" label="Address" required value={values.address} onChange={(v) => set('address', v)} error={error('address')} />
      <TextField id="city" label="City" required value={values.city} onChange={(v) => set('city', v)} error={error('city')} />
      <TextField id="country" label="Country" required value={values.country} onChange={(v) => set('country', v)} error={error('country')} />
    </FormSection>

    <FormSection title="Organisation" description="Choose the entity, then the direction, the department and the position.">
      {/* Cascade : la valeur ajoutée va dans le parent déjà choisi (ex. une direction dans l'entité choisie). */}
      <SelectField id="entity" label="Entity" required value={entity} onChange={changeEntity} options={entities.items} placeholder="Choose an entity"
        onAdd={adder(entities, changeEntity, { list: 'entities', title: 'Entité', parentChoice: { field: 'pole', label: 'Pôle', options: poles.items } })} />
      <SelectField id="direction" label="Direction" required value={direction} onChange={changeDirection} options={directions.items} placeholder={entity ? 'Choose a direction' : 'Choose an entity first'} disabled={!entity}
        onAdd={adder(directions, changeDirection, { list: 'directions', title: 'Direction', parent: { field: 'entity', value: entity, label: nameOf(entities, entity) } })} />
      <SelectField id="department" label="Department" required value={values.department} onChange={changeDepartment} options={departments.items} placeholder={direction ? 'Choose a department' : 'Choose a direction first'} disabled={!direction} error={error('department')}
        onAdd={adder(departments, changeDepartment, { list: 'departments', title: 'Service', parent: { field: 'direction', value: direction, label: nameOf(directions, direction) } })} />
      <SelectField id="position" label="Position" required value={values.position} onChange={(v) => set('position', v)} options={positions.items} placeholder={values.department ? 'Choose a position' : 'Choose a department first'} disabled={!values.department} error={error('position')}
        onAdd={adder(positions, (v) => set('position', v), { list: 'positions', title: 'Poste', parent: { field: 'department', value: values.department, label: nameOf(departments, values.department) } })} />
    </FormSection>

    <FormSection title="Contract">
      <SelectField id="contract_type" label="Contract type" required value={values.contract_type} onChange={(v) => set('contract_type', v)} options={contractTypes.items} error={error('contract_type')}
        onAdd={adder(contractTypes, (v) => set('contract_type', v), { list: 'contract-types', title: 'Type de contrat' })} />
      {isInterim && <SelectField id="temp_agency" label="Temp agency" required value={values.temp_agency} onChange={(v) => set('temp_agency', v)} options={tempAgencies.items} error={error('temp_agency')}
        onAdd={adder(tempAgencies, (v) => set('temp_agency', v), { list: 'temp-agencies', title: "Agence d'intérim" })} />}
      <SelectField id="category" label="Category" required value={values.category} onChange={(v) => set('category', v)} options={categories.items} error={error('category')}
        onAdd={adder(categories, (v) => set('category', v), { list: 'categories', title: 'Catégorie' })} />
      <SelectField id="grade" label="Grade" value={values.grade} onChange={(v) => set('grade', v)} options={grades.items} placeholder="None" error={error('grade')}
        onAdd={adder(grades, (v) => set('grade', v), { list: 'grades', title: 'Grade' })} />
      <SelectField id="division" label="Division" value={values.division} onChange={(v) => set('division', v)} options={divisions.items} placeholder="None" error={error('division')}
        onAdd={adder(divisions, (v) => set('division', v), { list: 'divisions', title: 'Division' })} />
      <SelectField id="assignment" label="Assignment" required value={values.assignment} onChange={(v) => set('assignment', v)} options={assignments.items} error={error('assignment')}
        onAdd={adder(assignments, (v) => set('assignment', v), { list: 'assignments', title: 'Affectation' })} />
      <SelectField id="region" label="Region" required value={values.region} onChange={(v) => set('region', v)} options={regions.items} error={error('region')}
        onAdd={adder(regions, (v) => set('region', v), { list: 'regions', title: 'Région' })} />
      <TextField id="work_location" label="Work location" required value={values.work_location} onChange={(v) => set('work_location', v)} error={error('work_location')} placeholder="Casablanca" />
      <SelectField id="cost_center" label="Cost center" value={values.cost_center} onChange={(v) => set('cost_center', v)} options={costCenters.items} placeholder="None" error={error('cost_center')}
        onAdd={adder(costCenters, (v) => set('cost_center', v), { list: 'cost-centers', title: 'Centre de coût', withCode: true })} />
    </FormSection>

    <FormSection title="Hierarchy & dates">
      <ManagerPicker value={values.manager} label={managerLabel} excludeId={employeeId} error={error('manager')}
        onChange={(id, label) => { set('manager', id); setManagerLabel(label) }} />
      <SelectField id="status" label="Status" required value={values.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} error={error('status')} />
      <TextField id="hire_date" label="Hire date" type="date" required value={values.hire_date} onChange={(v) => set('hire_date', v)} error={error('hire_date')} />
      <TextField id="trial_end_date" label="End of trial period" type="date" value={values.trial_end_date} onChange={(v) => set('trial_end_date', v)} error={error('trial_end_date')} />
      <TextField id="onboarding_end_date" label="End of onboarding" type="date" value={values.onboarding_end_date} onChange={(v) => set('onboarding_end_date', v)} error={error('onboarding_end_date')} />
      <TextField id="departure_date" label="Departure date" type="date" value={values.departure_date} onChange={(v) => set('departure_date', v)} error={error('departure_date')} />
      <TextField id="initial_leave_balance" label="Initial leave balance (days)" type="number" required value={values.initial_leave_balance} onChange={(v) => set('initial_leave_balance', v)} error={error('initial_leave_balance')} />
      {!isEdit && <SelectField id="role" label="Account role" required value={role} onChange={setRole}
        options={seesBothPoles(me) ? [...BASE_ROLES, ...HR_ROLES] : BASE_ROLES} error={error('role')} />}
    </FormSection>

    {/* Barre d'actions, toujours visible en bas de l'écran. */}
    <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200 bg-[#F1F5F9]/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
      {savedMessage && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" /> {savedMessage}</p>}
      <Link href="/employees" className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-500 hover:text-[#23355d]">Cancel</Link>
      <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#23355d] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-60">
        {saving && <Loader2 className="size-3.5 animate-spin" />}
        {isEdit ? 'Save changes' : 'Create employee'}
      </button>
    </div>
  </form>
  </>
}
