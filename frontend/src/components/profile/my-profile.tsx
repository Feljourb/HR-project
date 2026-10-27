'use client'

/*
 * "Mon profil" : chaque collaborateur voit SON dossier (/api/employees/me/).
 *
 * - Il modifie lui-même ses coordonnées et son contact d'urgence (PERSONAL_FIELDS).
 * - Le reste (poste, contrat, CIN, RIB...) est en lecture seule : pour le changer il faut
 *   un justificatif, donc c'est le RH qui le fait.
 * Django vérifie aussi (MyFicheSerializer) : un autre champ envoyé serait ignoré.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import {
  MARITAL_LABELS, PERSONAL_FIELDS, RELATIONSHIP_LABELS, STATUS_LABELS, TITLE_LABELS,
  type MyFiche, type PersonalField,
} from '@/lib/employees'
import { FormSection, SelectField, TextField } from '@/components/employees/form-fields'

type Values = Record<PersonalField, string>
type Errors = Record<string, string[]>  // les erreurs de Django : {"champ": ["message"]}

const RELATIONSHIP_OPTIONS = Object.entries(RELATIONSHIP_LABELS).map(([id, name]) => ({ id, name }))

/** Le dossier reçu -> les valeurs modifiables du formulaire. */
function valuesOf(fiche: MyFiche): Values {
  return Object.fromEntries(PERSONAL_FIELDS.map((name) => [name, fiche[name] ?? ''])) as Values
}

/** "2018-04-02" -> "02/04/2018" (le format de date habituel au Maroc). */
function formatDate(iso: string | null) {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR') : ''
}

/** Une information en lecture seule : un libellé et sa valeur ("—" si vide). */
function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div>
    <p className="text-xs font-semibold text-slate-500">{label}</p>
    <p className="mt-1 text-sm text-[#0F172A]">{children || '—'}</p>
  </div>
}

export function MyProfile() {
  const [fiche, setFiche] = useState<MyFiche | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [loadError, setLoadError] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    // AbortController : si on quitte la page avant la réponse, on annule la requête.
    const controller = new AbortController()
    apiFetch('/api/employees/me/', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          // 404 : aucun dossier RH lié à ce compte (ex. un compte IT).
          setLoadError(response.status === 404 ? 'No HR file is linked to your account yet. Please contact HR.' : 'Could not load your profile.')
          return
        }
        const data: MyFiche = await response.json()
        setFiche(data)
        setValues(valuesOf(data))
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError('Cannot reach the server. Please try again later.')
      })

    // Next.js garde la page en vie (cachée) quand on la quitte : on oublie le dossier
    // (CIN, RIB...), pour que la personne suivante sur ce navigateur ne le voie jamais.
    return () => {
      controller.abort()
      setFiche(null)
      setValues(null)
      setLoadError('')
      setErrors({})
      setSavedMessage('')
    }
  }, [])

  // Change un champ, et efface son ancienne erreur.
  function set(name: PersonalField, value: string) {
    setValues((current) => current && { ...current, [name]: value })
    setErrors((current) => ({ ...current, [name]: [] }))
    setSavedMessage('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!values) return
    setSaving(true)
    setErrors({})
    setSavedMessage('')
    try {
      // On envoie SEULEMENT les champs personnels (PATCH : le reste ne bouge pas).
      const response = await apiFetch('/api/employees/me/', { method: 'PATCH', body: JSON.stringify(values) })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setFiche(data)
        setValues(valuesOf(data))  // les valeurs nettoyées par Django
        setSavedMessage('Changes saved.')
      } else if (response.status === 400) {
        setErrors(data)  // chaque message s'affiche sous son champ
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
    </div>
  }

  // --- Écran 2 : chargement ---
  if (fiche === null || values === null) {
    return <p className="py-12 text-center text-sm text-slate-500">Loading...</p>
  }

  // --- Écran 3 : le profil ---
  return <form onSubmit={handleSubmit} className="flex flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-[#192646]">{fiche.first_name} {fiche.last_name}</h1>
      <p className="text-xs text-slate-500"><span className="font-mono">{fiche.u_number}</span> · {fiche.position} · {fiche.department}</p>
    </div>

    {error('non_field_errors') && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error('non_field_errors')}</p>}

    {/* Ce que le collaborateur peut modifier. */}
    <FormSection title="Contact details" description="You can update these yourself.">
      <TextField id="phone" label="Phone" type="tel" required value={values.phone} onChange={(v) => set('phone', v)} error={error('phone')} placeholder="0600000000" />
      <TextField id="address" label="Address" required value={values.address} onChange={(v) => set('address', v)} error={error('address')} />
      <TextField id="city" label="City" required value={values.city} onChange={(v) => set('city', v)} error={error('city')} />
      <TextField id="country" label="Country" required value={values.country} onChange={(v) => set('country', v)} error={error('country')} />
    </FormSection>

    <FormSection title="Emergency contact" description="The person to call if something happens to you at work.">
      <TextField id="emergency_contact_name" label="Full name" value={values.emergency_contact_name} onChange={(v) => set('emergency_contact_name', v)} error={error('emergency_contact_name')} />
      <SelectField id="emergency_contact_relationship" label="Relationship" value={values.emergency_contact_relationship} onChange={(v) => set('emergency_contact_relationship', v)} options={RELATIONSHIP_OPTIONS} placeholder="None" error={error('emergency_contact_relationship')} />
      <TextField id="emergency_contact_phone" label="Phone" type="tel" value={values.emergency_contact_phone} onChange={(v) => set('emergency_contact_phone', v)} error={error('emergency_contact_phone')} placeholder="0600000000" />
    </FormSection>

    {/* Lecture seule : géré par les RH. */}
    <FormSection title="Job" description="Managed by HR.">
      <Info label="Entity">{fiche.entity}</Info>
      <Info label="Direction">{fiche.direction}</Info>
      <Info label="Department">{fiche.department}</Info>
      <Info label="Position">{fiche.position}</Info>
      <Info label="Manager (N+1)">{fiche.manager}</Info>
      <Info label="Work location">{fiche.work_location}</Info>
      <Info label="Contract type">{fiche.contract_type}</Info>
      <Info label="Category">{fiche.category}</Info>
      <Info label="Grade">{fiche.grade}</Info>
      <Info label="Region">{fiche.region}</Info>
      <Info label="Hire date">{formatDate(fiche.hire_date)}</Info>
      <Info label="Status">{STATUS_LABELS[fiche.status]}</Info>
    </FormSection>

    <FormSection title="Personal information" description="To change this, contact HR with a supporting document.">
      <Info label="Title">{TITLE_LABELS[fiche.title]}</Info>
      <Info label="Birth date">{formatDate(fiche.birth_date)}</Info>
      <Info label="CIN">{fiche.cin}</Info>
      <Info label="Professional email">{fiche.professional_email}</Info>
      <Info label="Marital status">{MARITAL_LABELS[fiche.marital_status]}</Info>
      <Info label={`Children (${fiche.children.length})`}>
        {fiche.children.map((child) => `${child.first_name} (${formatDate(child.birth_date)})`).join(', ')}
      </Info>
    </FormSection>

    <FormSection title="Administrative file" description="To change this, contact HR with a supporting document.">
      <Info label="CNSS number">{fiche.cnss_number}</Info>
      <Info label="CIMR number">{fiche.cimr_number}</Info>
      <Info label="Bank">{fiche.bank}</Info>
      <Info label="RIB">{fiche.rib && <span className="font-mono">{fiche.rib}</span>}</Info>
    </FormSection>

    {/* Barre d'actions, toujours visible en bas de l'écran. */}
    <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-slate-200 bg-[#F1F5F9]/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
      {savedMessage && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" /> {savedMessage}</p>}
      <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#23355d] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#192646] disabled:cursor-not-allowed disabled:opacity-60">
        {saving && <Loader2 className="size-3.5 animate-spin" />}
        Save changes
      </button>
    </div>
  </form>
}
