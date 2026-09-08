import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { REQUIRED_COMMITMENT_FIELDS, type ProposalIntake, type RequiredCommitmentField } from '../lib/types'

// Keep in sync with MAX_FILE_BYTES in api/_lib/fileExtract.ts — checked here too
// so a too-large file is rejected before spending a round trip on it.
const MAX_FILE_BYTES = 4 * 1024 * 1024
const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx']

// Voice input uses the browser's own Web Speech API — free, no API key, no
// per-use cost, transcribing live while you talk. Not a Claude/Anthropic
// capability (their API has no audio input at all, images and text only) and
// not a recorded-file transcription service — Chrome/Edge only, and only
// while actively speaking into the mic.
interface MinimalSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
interface SpeechRecognitionResultEvent {
  resultIndex: number
  results: { [i: number]: { isFinal: boolean; [j: number]: { transcript: string } }; length: number }
}
type SpeechRecognitionConstructor = new () => MinimalSpeechRecognition
function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// The two existing, already-generated proposals used as live examples in the
// Use Cases section below — clicking one opens the real proposal page (with
// its intro fade-in/typewriter replayed via `animateIntro` nav state) rather
// than a static mockup.
const RETAIL_USE_CASE_ID = '4a205709-6d9f-43c1-8451-d1ca954d090f'
const HOTEL_USE_CASE_ID = '4f209a72-b88e-49de-a581-cf39cfb8d40e'

const EMPTY: ProposalIntake = {
  client_name: '',
  client_email: '',
  company_name: '',
  date_of_call: '',
  salesperson_name: '',
  client_needs_summary: '',
  project_scope: '',
  goals_and_objectives: '',
  recommended_services: '',
  proposed_timeline: '',
  estimated_pricing: '',
  supporting_material: '',
}

function computeMissingFields(intake: ProposalIntake): RequiredCommitmentField[] {
  return REQUIRED_COMMITMENT_FIELDS.filter((key) => !intake[key]?.trim())
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function IntakeForm() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<'compose' | 'review'>('compose')
  const [values, setValues] = useState<ProposalIntake>(EMPTY)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  function showToast(message: string) {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4500)
  }

  // Salesperson name means the Proposally staffer acting on our behalf, not
  // anyone at the client's company — so it's auto-filled from the logged-in
  // account rather than left for extraction to guess at from the source
  // text. Only fills if still empty, so it never overwrites a hand edit.
  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    supabase
      .from('staff')
      .select('display_name')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const name = data?.display_name
        if (name) setValues((v) => (v.salesperson_name ? v : { ...v, salesperson_name: name }))
      })
  }, [session?.user.id])

  // Stop any in-progress recording if the user navigates away mid-recording,
  // rather than leaving the browser's mic indicator on after the composer's gone.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  // Compose step: one free-text description plus any number of attached
  // files/photos, all sent together in a single extraction call — this is
  // what lets meeting notes, a company-info doc, and a typed description
  // combine into one set of fields, rather than needing separate uploads.
  const [description, setDescription] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractSummary, setExtractSummary] = useState<string | null>(null)

  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null)
  const descriptionAtStartRef = useRef('')
  const speechSupported = Boolean(getSpeechRecognitionCtor())

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop()
      return
    }
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    descriptionAtStartRef.current = description ? `${description} ` : ''
    recognition.onresult = (event) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        if (result.isFinal) {
          descriptionAtStartRef.current += `${transcript} `
        } else {
          interimText += transcript
        }
      }
      setDescription(descriptionAtStartRef.current + interimText)
    }
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognition.start()
    recognitionRef.current = recognition
    setRecording(true)
  }

  function set<K extends keyof ProposalIntake>(key: K, value: ProposalIntake[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setExtractError(null)
    const incoming = Array.from(fileList)
    const oversize = incoming.find((f) => f.size > MAX_FILE_BYTES)
    if (oversize) {
      setExtractError(`"${oversize.name}" is too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB).`)
      return
    }
    setPendingFiles((prev) => [...prev, ...incoming])
  }

  function removeAttachment(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // The composer's send button — runs extraction (if there's anything to
  // extract from) against the free text plus every attached file/photo in
  // one combined call, then moves to the review step with fields pre-filled.
  // With nothing typed or attached, it just moves to an empty review step —
  // equivalent to today's "start from scratch" path.
  async function handleCompose() {
    const trimmedDescription = description.trim()
    if (!trimmedDescription && pendingFiles.length === 0) {
      setStep('review')
      return
    }

    setExtracting(true)
    setExtractError(null)
    setExtractSummary(null)
    try {
      const filesPayload = await Promise.all(
        pendingFiles.map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })),
      )
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ description: trimmedDescription, files: filesPayload }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setExtractError(body.error ?? `Extraction failed (${res.status})`)
        return
      }

      // Merges into whatever's already there rather than overwriting — matters
      // if the user goes back to the composer and sends a second source (or
      // had already hand-edited a field), so nothing already filled in gets
      // silently clobbered.
      const filled: (keyof ProposalIntake)[] = []
      const next = { ...values }
      for (const key of Object.keys(body.fields) as (keyof ProposalIntake)[]) {
        const extractedValue = body.fields[key]
        if (extractedValue && !values[key]?.trim()) {
          next[key] = extractedValue
          filled.push(key)
        }
      }
      setValues(next)

      const missingCommitments = (body.missingRequiredFields as string[]) ?? []
      const sourceLabel = [trimmedDescription ? 'your description' : null, ...body.filesProcessed].filter(Boolean).join(', ')
      setExtractSummary(
        filled.length > 0
          ? `Extracted from ${sourceLabel}. Filled ${filled.length} field${filled.length === 1 ? '' : 's'}` +
              (missingCommitments.length > 0 ? `. Not found — fill in manually: ${missingCommitments.join(', ')}` : '')
          : `Nothing usable was found in ${sourceLabel}. Fill in the fields manually below.`,
      )
      setStep('review')
      setPendingFiles([])
      setDescription('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (imageInputRef.current) imageInputRef.current.value = ''
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction request failed')
    } finally {
      setExtracting(false)
    }
  }

  async function handleGenerate() {
    const missing_fields = computeMissingFields(values)
    if (missing_fields.length > 0) {
      showToast(
        `${missing_fields.length} required field${missing_fields.length > 1 ? 's' : ''} left blank — the proposal will show a placeholder there instead of a guess.`,
      )
    }

    setGenerating(true)
    setError(null)

    const { data, error: saveError } = await supabase
      .from('proposals')
      .insert({
        ...values,
        date_of_call: values.date_of_call || null,
        missing_fields,
        status: 'draft',
        created_by: session?.user.id,
      })
      .select('id')
      .single()

    if (saveError) {
      setError(saveError.message)
      setGenerating(false)
      return
    }

    // The draft is saved — hand off to the proposal page, which runs the
    // actual /api/generate call itself (triggered by the justGenerated flag)
    // and shows live progress there instead of blocking this form.
    navigate(`/proposal/${data.id}`, { state: { justGenerated: true } })
  }

  return (
    <div className="hero-shell">
      <div className="hero-inner">
      <div className="hero-badge">
        <SparkleIcon />
        AI Generated
      </div>
      <h1 className="hero-title">AI proposal generator</h1>
      <p className="hero-subtitle">
        Describe your project and client, and download a structured business proposal as an
        editable Word or PDF file.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={(e) => {
          handleFilesSelected(e.target.files)
          e.target.value = ''
        }}
        style={{ display: 'none' }}
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => {
          handleFilesSelected(e.target.files)
          e.target.value = ''
        }}
        style={{ display: 'none' }}
      />

      {step === 'compose' ? (
        <div className="composer">
          <textarea
            className="composer-input"
            rows={3}
            placeholder="Upload docs, paste notes, speak or snap..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={extracting}
          />

          {pendingFiles.length > 0 && (
            <div className="composer-attachments">
              {pendingFiles.map((f, i) => (
                <span className="attachment-chip" key={`${f.name}-${i}`}>
                  {f.name}
                  <button type="button" onClick={() => removeAttachment(i)} disabled={extracting} aria-label={`Remove ${f.name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {extractError && <div className="banner danger" style={{ marginTop: 12 }}>{extractError}</div>}

          <div className="composer-toolbar">
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              title="Attach a document"
            >
              <PaperclipIcon />
            </button>
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => imageInputRef.current?.click()}
              disabled={extracting}
              title="Attach a photo"
            >
              <CameraIcon />
            </button>
            <button
              type="button"
              className={`composer-icon-btn${recording ? ' recording' : ''}`}
              onClick={toggleRecording}
              disabled={extracting || !speechSupported}
              title={speechSupported ? (recording ? 'Stop recording' : 'Speak — transcribes live in this browser') : 'Voice input needs Chrome or Edge'}
            >
              <MicIcon />
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="composer-send"
              onClick={() => void handleCompose()}
              disabled={extracting}
              title="Send"
            >
              {extracting ? <SpinnerIcon /> : <ArrowUpIcon />}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'compose' && (
        <p className="manual-fill-hint">
          Prefer to type it yourself?{' '}
          <button type="button" className="link" onClick={() => setStep('review')}>
            Fill it in manually
          </button>
        </p>
      )}

      {step === 'review' && (
      <div className="hero-card">
        <div style={{ marginBottom: 16 }}>
          <button type="button" className="link" onClick={() => setStep('compose')}>
            ← Back to description
          </button>
        </div>

        {extractSummary && <div className="banner warning" style={{ marginBottom: 20 }}>{extractSummary}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <label htmlFor="project_scope">Project scope<RequiredMark /></label>
            <textarea id="project_scope" value={values.project_scope} onChange={(e) => set('project_scope', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="recommended_services">Deliverables / services<RequiredMark /></label>
            <textarea id="recommended_services" value={values.recommended_services} onChange={(e) => set('recommended_services', e.target.value)} />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="proposed_timeline">Timeline<RequiredMark /></label>
              <textarea id="proposed_timeline" value={values.proposed_timeline} onChange={(e) => set('proposed_timeline', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="estimated_pricing">Budget<RequiredMark /></label>
              <textarea id="estimated_pricing" value={values.estimated_pricing} onChange={(e) => set('estimated_pricing', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="client_name">Client name<RequiredMark /></label>
              <input id="client_name" value={values.client_name} onChange={(e) => set('client_name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="client_email">Client email<RequiredMark /></label>
              <input id="client_email" type="email" value={values.client_email} onChange={(e) => set('client_email', e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="company_name">Company name<RequiredMark /></label>
              <input id="company_name" value={values.company_name} onChange={(e) => set('company_name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="date_of_call">Date of call</label>
              <input id="date_of_call" type="date" value={values.date_of_call} onChange={(e) => set('date_of_call', e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="salesperson_name">Salesperson name</label>
            <input id="salesperson_name" value={values.salesperson_name} onChange={(e) => set('salesperson_name', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="client_needs_summary">Summary of client's needs<RequiredMark /></label>
            <textarea id="client_needs_summary" value={values.client_needs_summary} onChange={(e) => set('client_needs_summary', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="goals_and_objectives">Goals and objectives</label>
            <textarea id="goals_and_objectives" value={values.goals_and_objectives} onChange={(e) => set('goals_and_objectives', e.target.value)} />
            <span className="hint">Outcomes wanted — revenue, efficiency, less manual work.</span>
          </div>

          <div className="field">
            <label htmlFor="supporting_material">Supporting material (optional)</label>
            <textarea id="supporting_material" value={values.supporting_material} onChange={(e) => set('supporting_material', e.target.value)} />
            <span className="hint">Context for specificity — not a source of new commitments.</span>
          </div>
        </div>

        {error && <div className="banner danger" style={{ marginTop: 20 }}>{error}</div>}
      </div>
      )}

      {step === 'review' && (
      <div className="hero-generate">
        <button type="button" className="pill-btn" onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate proposal'}
        </button>
      </div>
      )}

      {step === 'compose' && (
      <>
      <section className="usecases">
        <h2 className="usecases-title">Use Cases</h2>
        <div className="usecases-grid">
          <Link
            to={`/proposal/${RETAIL_USE_CASE_ID}`}
            state={{ animateIntro: true }}
            className="usecase-card"
          >
            <div className="usecase-frame usecase-frame-retail">
              <div className="frame-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="frame-doc">
                <div className="frame-doc-title">Proposal: BrightPath Retail</div>
                <div className="frame-doc-meta">
                  <span>To: Sarah Mensah</span>
                  <span>Timeline: 6 weeks</span>
                </div>
                <div className="frame-doc-line" />
                <div className="frame-doc-line" />
                <div className="frame-doc-line short" />
              </div>
            </div>
            <h3>Proposal for Retail Inventory Sync</h3>
            <p>
              Turn client inventory challenges into structured integration proposals. Proposally
              transforms stock-syncing pain points across Shopify and physical POS systems into
              detailed proposals complete with a 6-week timeline, itemized deliverables, and
              installment pricing.
            </p>
          </Link>

          <Link
            to={`/proposal/${HOTEL_USE_CASE_ID}`}
            state={{ animateIntro: true }}
            className="usecase-card"
          >
            <div className="usecase-frame usecase-frame-hotel">
              <div className="frame-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="frame-doc">
                <div className="frame-doc-title">Proposal: Haven Boutique Hotels</div>
                <div className="frame-doc-meta">
                  <span>To: Marcus Webb</span>
                  <span>Timeline: 8 weeks</span>
                </div>
                <div className="frame-doc-line" />
                <div className="frame-doc-line" />
                <div className="frame-doc-line short" />
              </div>
            </div>
            <h3>Proposal for Hotel Management Systems</h3>
            <p>
              Draft tailored booking and guest-profile proposals for multi-property hospitality
              clients. Proposally analyzes operational bottlenecks like double-bookings, outlining
              custom database solutions alongside clear 8-week rollout schedules, core
              deliverables, and milestone-based pricing structures.
            </p>
          </Link>
        </div>
      </section>

      <section className="howitworks">
        <h2 className="howitworks-title">How to create a proposal with our AI</h2>
        <div className="howitworks-grid">
          <div className="howitworks-card">
            <div className="howitworks-num">01</div>
            <h3>Describe, paste, speak or snap</h3>
            <p>Type the project details, paste an email, record a voice note, or attach a photo. Combine them all in one box.</p>
          </div>
          <div className="howitworks-card">
            <div className="howitworks-num">02</div>
            <h3>AI fills in the proposal</h3>
            <p>It reads the parties, dates and terms into a clean proposal template, and asks if anything essential is missing.</p>
          </div>
          <div className="howitworks-card">
            <div className="howitworks-num">03</div>
            <h3>Preview and download</h3>
            <p>Check the finished proposal in the preview, then download an editable Word .docx or a PDF and add your own narrative.</p>
          </div>
        </div>
      </section>

      <section className="closing-cta">
        <h2>
          Stop formatting,
          <br />
          start closing.
        </h2>
      </section>
      </>
      )}
      </div>

      {step === 'compose' && (
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="site-footer-brand">
              <img src="/favicon.png" alt="" height={26} />
              <span>Proposally</span>
            </div>
            <nav className="site-footer-links">
              <Link to="/">Templates</Link>
              <Link to="/proposals">All proposals</Link>
              <Link to="/account">Account</Link>
            </nav>
          </div>
          <p className="site-footer-copyright">© 2026 Proposally. All rights reserved.</p>
        </footer>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function RequiredMark() {
  return (
    <span aria-hidden="true" style={{ color: 'var(--danger)' }}>
      {' '}*
    </span>
  )
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" opacity="0.7" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v4" />
      <path d="M8 23h8" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="spinner-icon" aria-hidden="true">
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  )
}
