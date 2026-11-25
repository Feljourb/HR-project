'use client'

/*
 * UN questionnaire (2026-11-25, règle "one shared thing = one component") : l'entretien de sortie aujourd'hui, et plus
 * tard le module "Enquêtes & NPS" et les évaluations le réutilisent. Générique : il reçoit les questions et les
 * réponses, et renvoie les réponses ; il ne sait rien des départs.
 * 4 types de réponse : texte libre, note de 1 à 5 (5 boutons), un choix dans une liste, oui / non.
 * Les réponses : { "id de la question": "texte" | "1".."5" | "le choix" | "yes" / "no" }.
 */
import { cn } from '@/lib/utils'

export type QuestionnaireQuestion = { id: number; text: string; kind: 'TEXT' | 'RATING' | 'CHOICE' | 'YES_NO'; choices: string[]; required: boolean }

export function Questionnaire({ questions, answers, onChange, readOnly = false }: {
  questions: QuestionnaireQuestion[]
  answers: Record<string, string>
  onChange?: (answers: Record<string, string>) => void
  readOnly?: boolean
}) {
  const set = (id: number, value: string) => onChange?.({ ...answers, [String(id)]: value })

  return <ol className="flex flex-col gap-4">
    {questions.map((question, index) => {
      const value = answers[String(question.id)] ?? ''
      const label = `${index + 1}. ${question.text}`
      return <li key={question.id} className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-slate-700">{label}{question.required && <span className="text-red-600"> *</span>}</p>

        {readOnly
          ? <p className="text-sm text-[#192646]">{display(question, value)}</p>
          : <>
            {question.kind === 'TEXT' && <textarea value={value} onChange={(e) => set(question.id, e.target.value)} rows={2} maxLength={2000}
              aria-label={question.text}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#23355d] focus:bg-white" />}

            {question.kind === 'RATING' && <div className="flex items-center gap-1.5" role="radiogroup" aria-label={question.text}>
              {['1', '2', '3', '4', '5'].map((score) => <button key={score} type="button" role="radio" aria-checked={value === score}
                onClick={() => set(question.id, value === score ? '' : score)}
                className={cn('size-9 rounded-lg border text-sm font-semibold transition-colors',
                  value === score ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40')}>
                {score}
              </button>)}
              <span className="ml-1 text-[11px] text-slate-400">1 = very bad · 5 = very good</span>
            </div>}

            {question.kind === 'CHOICE' && <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={question.text}>
              {question.choices.map((choice) => <button key={choice} type="button" role="radio" aria-checked={value === choice}
                onClick={() => set(question.id, value === choice ? '' : choice)}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  value === choice ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40')}>
                {choice}
              </button>)}
            </div>}

            {question.kind === 'YES_NO' && <div className="flex gap-1.5" role="radiogroup" aria-label={question.text}>
              {[['yes', 'Yes'], ['no', 'No']].map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={value === id}
                onClick={() => set(question.id, value === id ? '' : id)}
                className={cn('rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors',
                  value === id ? 'border-[#23355d] bg-[#23355d] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#23355d]/40')}>
                {text}
              </button>)}
            </div>}
          </>}
      </li>
    })}
  </ol>
}

/** Une réponse en lecture : "4 / 5", "Yes", le texte, ou "—". */
function display(question: QuestionnaireQuestion, value: string) {
  if (!value) return '—'
  if (question.kind === 'RATING') return `${value} / 5`
  if (question.kind === 'YES_NO') return value === 'yes' ? 'Yes' : 'No'
  return value
}
