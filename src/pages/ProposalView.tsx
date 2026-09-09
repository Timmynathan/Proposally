import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { sha256Hex } from '../lib/hash'
import { SectionContent } from '../lib/SectionContent'
import { DocumentHeader } from '../lib/DocumentHeader'
import { buildFullPrompt, buildNarration } from '../lib/promptSummary'
import { Typewriter } from '../lib/Typewriter'
import { DownloadMenu } from '../lib/DownloadMenu'
import {
  SECTION_KEYS,
  type ProposalRow,
  type ProposalSectionRow,
  type ProposalEventRow,
  type ProposalApprovalRow,
  type SectionKey,
} from '../lib/types'

const GENERATING_STEPS = [
  'Reviewing the proposal details',
  'Writing introduction, scope, deliverables, timeline, pricing and next steps',
  'Verifying every commitment is reproduced exactly as supplied',
  'Saving your proposal',
]

const INTRO_FADE_MS = 700
const INTRO_TYPE_SPEED_MS = 18
const INTRO_CHECK_STEP_MS = 450

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type IntroPhase = 'fade' | 'type' | 'checks' | 'ready'

// A single page, styled as an actual two-message chat thread: your intake
// data as one message, then a reply from Proposally (avatar + opening line +
// activity checklist ticking through while /api/generate runs + "Here's your
// proposal") as the next message. The result starts as a small collapsed
// card inside that reply and expands in place to the full editable document.
// This replaces the old two-page hop through a separate /generating/:id
// screen — everything now lives on one page, for both a proposal fresh off
// intake and one reopened later from the list (which just renders the same
// thread already "finished," with no live ticking to replay).
export function ProposalView() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navState = location.state as { justGenerated?: boolean; animateIntro?: boolean } | null
  const justGenerated = Boolean(navState?.justGenerated)
  // Fresh generation always animates; a Use Cases card click also asks for
  // the intro replay (via animateIntro) without re-running real generation —
  // reopening a proposal normally (no nav state) never animates.
  const animateIntro = justGenerated || Boolean(navState?.animateIntro)

  const [proposal, setProposal] = useState<ProposalRow | null>(null)
  const [sections, setSections] = useState<ProposalSectionRow[]>([])
  const [events, setEvents] = useState<ProposalEventRow[]>([])
  const [approvals, setApprovals] = useState<ProposalApprovalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [editingKey, setEditingKey] = useState<SectionKey | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [steerByKey, setSteerByKey] = useState<Record<string, string>>({})
  const [hashProof, setHashProof] = useState<{ key: SectionKey; before: string; after: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [docExpanded, setDocExpanded] = useState(false)
  const [generatingLive, setGeneratingLive] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // Choreographed intro: fade in the prompt, then (only once that's done)
  // type out the narration, then (only once that's done) tick the checklist
  // one item at a time, and only once ALL of that has played AND the real
  // data is ready does the doc appear. Skipped entirely on a plain reopen —
  // introPhase starts at 'ready' and introCheckStep at "all done" so
  // everything just renders statically like before.
  const [introPhase, setIntroPhase] = useState<IntroPhase>(animateIntro ? 'fade' : 'ready')
  const [introCheckStep, setIntroCheckStep] = useState(animateIntro ? 0 : GENERATING_STEPS.length)

  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const load = useCallback(async () => {
    if (!id) return { proposal: null, sections: [] as ProposalSectionRow[] }
    setLoading(true)
    const [{ data: p, error: pErr }, { data: s }, { data: e }, { data: a }] = await Promise.all([
      supabase.from('proposals').select('*').eq('id', id).single(),
      supabase.from('proposal_sections').select('*').eq('proposal_id', id).order('position'),
      supabase.from('proposal_events').select('*').eq('proposal_id', id).order('at', { ascending: false }).limit(15),
      supabase.from('proposal_approvals').select('*').eq('proposal_id', id).order('decided_at', { ascending: false }).limit(5),
    ])
    if (pErr) setError(pErr.message)
    const loadedSections = (s as ProposalSectionRow[]) ?? []
    setProposal(p as ProposalRow)
    setSections(loadedSections)
    setEvents((e as ProposalEventRow[]) ?? [])
    setApprovals((a as ProposalApprovalRow[]) ?? [])
    setLoading(false)
    return { proposal: p as ProposalRow | null, sections: loadedSections }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function authHeader() {
    const { data } = await supabase.auth.getSession()
    return `Bearer ${data.session?.access_token ?? ''}`
  }

  // Runs the actual generation call. The checklist's ticking is purely
  // cosmetic pacing now (see the intro-sequence effect below), decoupled
  // from how long the real request actually takes — this just does the
  // real work and flags when it's done.
  const runGenerationFlow = useCallback(async () => {
    setGeneratingLive(true)
    setGenError(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
        body: JSON.stringify({ proposalId: id }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setGenError(body.error ?? `Generation failed (${res.status})`)
        await load()
        setGeneratingLive(false)
        return
      }
      await load()
      setGeneratingLive(false)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation request failed')
      setGeneratingLive(false)
    }
  }, [id, load])

  // Ref-only guard (no cleanup-based cancellation) — a `cancelled` flag set
  // by a cleanup function would poison this closure under React 18
  // StrictMode's dev-only double-invoke before the first await even
  // resolves, since ranRef already blocks the second invocation from
  // starting a fresh run. See GeneratingProposal's old bug for the long
  // version of this story.
  const ranRef = useRef(false)
  useEffect(() => {
    if (!id || ranRef.current || !justGenerated) return
    ranRef.current = true
    void runGenerationFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // The cosmetic sequence itself — fade, then type, then tick the checklist
  // one item at a time. Runs once proposal data exists to build the
  // narration text from. Same ref-only-guard reasoning as above: no
  // cleanup-based cancellation, since a StrictMode phantom cleanup would
  // poison this closure before its first `wait()` even resolves.
  const introRanRef = useRef(false)
  useEffect(() => {
    if (!animateIntro || introRanRef.current || !proposal) return
    introRanRef.current = true
    const narration = buildNarration(proposal)
    async function run() {
      await wait(INTRO_FADE_MS)
      setIntroPhase('type')
      await wait(narration.length * INTRO_TYPE_SPEED_MS + 300)
      setIntroPhase('checks')
      for (let i = 1; i <= GENERATING_STEPS.length; i++) {
        await wait(INTRO_CHECK_STEP_MS)
        setIntroCheckStep(i)
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal])

  // Only once the checklist has finished ticking AND (for a real fresh
  // generation) the actual data has arrived does the doc appear — if the
  // real request is still running when the cosmetic checks finish, this
  // just holds at "checks" until hasSections flips true.
  useEffect(() => {
    if (introPhase !== 'checks') return
    if (introCheckStep < GENERATING_STEPS.length) return
    if (justGenerated && sections.length === 0) return
    setIntroPhase('ready')
  }, [introPhase, introCheckStep, justGenerated, sections.length])

  function hashInputForOthers(key: SectionKey): string {
    return sections
      .filter((s) => s.key !== key)
      .sort((a, b) => a.position - b.position)
      .map((s) => `${s.key}:${s.content ?? ''}`)
      .join('\n---\n')
  }

  async function handleRegenerate(key: SectionKey) {
    setBusy(`regen:${key}`)
    setError(null)
    setHashProof(null)
    const before = await sha256Hex(hashInputForOthers(key))
    try {
      const res = await fetch('/api/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
        body: JSON.stringify({ proposalId: id, sectionKey: key, steer: steerByKey[key] ?? '' }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) setError(body.error ?? `Regeneration failed (${res.status})`)
      await load()
      const after = await sha256Hex(hashInputForOthers(key))
      setHashProof({ key, before, after })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regeneration request failed')
    } finally {
      setBusy(null)
    }
  }

  function startEdit(key: SectionKey, content: string | null) {
    setEditingKey(key)
    setEditDraft(content ?? '')
  }

  async function saveEdit(key: SectionKey) {
    if (!id) return
    setBusy(`save:${key}`)
    setError(null)
    const { error } = await supabase
      .from('proposal_sections')
      .update({ content: editDraft, edited_by_human: true })
      .eq('proposal_id', id)
      .eq('key', key)
    setBusy(null)
    if (error) {
      setError(error.message)
      return
    }
    setEditingKey(null)
    await load()
  }

  async function handleSubmitForReview() {
    if (!id || !proposal) return
    setBusy('submit')
    setError(null)
    const { error } = await supabase.from('proposals').update({ status: 'in_review' }).eq('id', id)
    if (!error) {
      await supabase.from('proposal_events').insert({ proposal_id: id, event: 'submitted', ok: true, detail: {} })
    } else {
      setError(error.message)
    }
    setBusy(null)
    await load()
  }

  async function handleSend() {
    if (!id) return
    setBusy('send')
    setError(null)
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
        body: JSON.stringify({ proposalId: id }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) setError(body.error ?? `Send failed (${res.status})`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send request failed')
    } finally {
      setBusy(null)
    }
  }

  async function fetchPdfBlob(): Promise<Blob> {
    if (!id) throw new Error('Missing proposal id')
    const res = await fetch(`/api/pdf?id=${id}`, { headers: { Authorization: await authHeader() } })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `PDF failed (${res.status})` }))
      throw new Error(body.error ?? `PDF failed (${res.status})`)
    }
    return res.blob()
  }

  async function handleCopyLink() {
    if (!proposal || proposal.status !== 'sent') return
    const url = `${window.location.origin}/p/${proposal.share_token}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Only blocks render on the very first load. `load()` also runs again
  // later (after generation completes, after an edit, etc.) and flips
  // `loading` back to true for that background refresh — if this gated on
  // `loading` alone, that would swap the whole tree out for this line and
  // back, unmounting everything below (including the intro/typewriter
  // sequence) and replaying it from scratch once the refresh finished.
  if (loading && !proposal) return <p className="empty-state">Loading…</p>
  if (!proposal) return <p className="empty-state">Proposal not found.</p>

  const hasSections = sections.length > 0
  const latestApproval = approvals[0]
  const actionsDisabled = generatingLive
  // Narrowed alias — TS's control-flow narrowing from the `if (!proposal)
  // return` above doesn't carry into nested function declarations below
  // (docHeaderActions), so `proposal.status` there would still type as
  // possibly-null without this.
  const proposalStatus = proposal.status
  const narrowedProposal = proposal

  // Shared between the small capped preview card and the full-screen modal —
  // same document, two different frames around it, so this is computed once
  // rather than duplicated (and risking the two copies drifting apart).
  const docBody = (
    <>
      {(proposal.status === 'draft' || proposal.status === 'rejected' || proposal.status === 'in_review' || proposal.status === 'approved') && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {(proposal.status === 'draft' || proposal.status === 'rejected') && (
            <button className="primary" onClick={handleSubmitForReview} disabled={busy === 'submit'}>
              {busy === 'submit' ? 'Submitting…' : 'Submit for review'}
            </button>
          )}
          {proposal.status === 'in_review' && (
            <span className="banner" style={{ alignSelf: 'center' }}>Awaiting reviewer decision.</span>
          )}
          {proposal.status === 'approved' && (
            <button className="primary" onClick={handleSend} disabled={busy === 'send' || proposal.missing_fields.length > 0}>
              {busy === 'send' ? 'Sending…' : 'Send to client'}
            </button>
          )}
        </div>
      )}

      <DocumentHeader
        companyName={proposal.company_name}
        clientName={proposal.client_name}
        salespersonName={proposal.salesperson_name}
        sentAt={proposal.sent_at}
        estimatedPricing={proposal.estimated_pricing}
        proposedTimeline={proposal.proposed_timeline}
      />

      {SECTION_KEYS.map((key) => {
        const section = sections.find((s) => s.key === key)
        const isEditing = editingKey === key
        return (
          <div className="section-block card" key={key} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <h3 style={{ marginBottom: 4 }}>
                {key.replace('_', ' ')}{' '}
                {section?.edited_by_human && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>(manually edited)</span>
                )}
              </h3>
              {!isEditing && (
                <button onClick={() => startEdit(key, section?.content ?? '')} style={{ fontSize: '0.8rem' }}>
                  Edit
                </button>
              )}
            </div>

            {isEditing ? (
              <>
                <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={8} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="primary" onClick={() => saveEdit(key)} disabled={busy === `save:${key}`}>
                    {busy === `save:${key}` ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingKey(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <SectionContent content={section?.content} />
            )}

            {!isEditing && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  placeholder="Optional steer for regeneration, e.g. 'more concise'"
                  value={steerByKey[key] ?? ''}
                  onChange={(e) => setSteerByKey((v) => ({ ...v, [key]: e.target.value }))}
                  style={{ flex: 1 }}
                />
                <button onClick={() => handleRegenerate(key)} disabled={busy === `regen:${key}`}>
                  {busy === `regen:${key}` ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            )}

            {hashProof?.key === key && (
              <p className="hint" style={{ marginTop: 8 }}>
                {hashProof.before === hashProof.after
                  ? '✓ Other five sections unchanged (hash match).'
                  : '⚠ Other sections changed — hash mismatch (unexpected for a single-section regenerate).'}
              </p>
            )}
          </div>
        )
      })}

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => void runGenerationFlow()}>Regenerate entire proposal</button>
      </div>

      <details style={{ marginTop: 24, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <summary>Activity ({events.length})</summary>
        <table style={{ marginTop: 8 }}>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap', color: e.ok ? 'var(--success)' : 'var(--danger)' }}>{e.ok ? '✓' : '✗'} {e.event}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleTimeString()}</td>
                <td style={{ fontSize: '0.78rem' }}>{JSON.stringify(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <summary>Intake data</summary>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{JSON.stringify(proposal, null, 2)}</pre>
      </details>
    </>
  )

  function docHeaderActions(extra?: ReactNode) {
    return (
      <div className="doc-window-header-actions" onClick={(e) => e.stopPropagation()}>
        <DownloadMenu
          proposal={narrowedProposal}
          sections={sections}
          fetchPdfBlob={fetchPdfBlob}
          disabled={actionsDisabled}
          onError={setError}
          onPdfDownloaded={load}
        />

        <div className="menu-wrap" ref={moreMenuRef}>
          <button className="icon-btn" onClick={() => setMoreMenuOpen((v) => !v)} disabled={actionsDisabled} title="More">
            <MoreIcon />
          </button>
          {moreMenuOpen && (
            <div className="menu-dropdown">
              <button
                className="menu-item"
                disabled={proposalStatus !== 'sent'}
                onClick={() => {
                  handleCopyLink()
                  setMoreMenuOpen(false)
                }}
              >
                <LinkIcon />
                {proposalStatus === 'sent' ? 'Copy link' : 'Copy link (after sending)'}
              </button>
            </div>
          )}
        </div>

        {copied && <span className="copied-tooltip">Copied!</span>}
        {extra}
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ margin: 0 }}>Proposal for {proposal.company_name || 'Untitled'}</h1>

      {latestApproval?.decision === 'approved' && <div className="approved-stamp">✓ Approved</div>}

      {proposal.missing_fields.length > 0 && (
        <div className="banner warning" style={{ marginTop: 12 }}>
          Missing required fields: {proposal.missing_fields.join(', ')}. These render as visible
          markers below. Sending is blocked — by the database, not just this screen — until
          they're filled in.
        </div>
      )}

      {latestApproval?.decision === 'rejected' && (
        <div className="banner danger" style={{ marginTop: 12 }}>
          <strong>Rejected</strong> {new Date(latestApproval.decided_at).toLocaleString()}
          {latestApproval.comment ? ` — "${latestApproval.comment}"` : ''}
        </div>
      )}

      {proposal.status === 'sent' && (
        <div className="banner success" style={{ marginTop: 12 }}>
          Sent to client{proposal.sent_at ? ` on ${new Date(proposal.sent_at).toLocaleDateString()}` : ''}. Use the
          share icon above to copy the link.
        </div>
      )}

      {error && <div className="banner danger" style={{ marginTop: 12 }}>{error}</div>}

      <div className="chat-thread">
        <div className="chat-msg chat-msg-user">
          <div className={`chat-bubble${animateIntro ? ' fade-in' : ''}`}>
            {buildFullPrompt(proposal)
              .split('\n\n')
              .map((para, i) => (
                <p key={i} style={{ margin: i === 0 ? 0 : '10px 0 0' }}>
                  {para}
                </p>
              ))}
          </div>
        </div>

        <div className="chat-msg chat-msg-assistant">
          <img src="/favicon.png" alt="" className="chat-avatar" />
          <div className="chat-msg-body">
            <div className="chat-sender-name">Proposally</div>
            <div className="chat-bubble">
            {introPhase !== 'fade' && (
              <p style={{ margin: 0 }}>
                <Typewriter text={buildNarration(proposal)} active={animateIntro} />
              </p>
            )}

            {(introPhase === 'checks' || introPhase === 'ready') && (generatingLive || hasSections) && (
              <ul className="generating-steps" style={{ marginTop: 14 }}>
                {GENERATING_STEPS.map((step, i) => {
                  const done = i < introCheckStep
                  return (
                    <li key={step} className={done ? 'done' : ''}>
                      <span className="step-mark">{done ? '✓' : '○'}</span> {step}
                    </li>
                  )
                })}
              </ul>
            )}

            {genError && <div className="banner danger" style={{ marginTop: 8 }}>{genError}</div>}

            {!generatingLive && !hasSections && !genError && introPhase !== 'fade' && (
              <button className="primary" style={{ marginTop: 12 }} onClick={() => void runGenerationFlow()}>
                Generate proposal
              </button>
            )}

            {!generatingLive && hasSections && introPhase === 'ready' && <p style={{ margin: '14px 0 0' }}>Here's your proposal:</p>}
            </div>

            {!generatingLive && hasSections && introPhase === 'ready' && (
              <div className="doc-window doc-window-preview" onClick={() => setDocExpanded(true)}>
                <div className="doc-window-header">
                  <div className="doc-window-header-main">
                    <DocIcon />
                    <span className="doc-window-title">Proposal: {proposal.company_name || 'Untitled'}</span>
                  </div>
                  {docHeaderActions()}
                </div>
                <div className="doc-window-body">{docBody}</div>
                <div className="doc-window-fade" />
              </div>
            )}
          </div>
        </div>

        {docExpanded && (
          <div className="doc-modal-backdrop" onClick={() => setDocExpanded(false)}>
            <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
              <div className="doc-window-header">
                <div className="doc-window-header-main">
                  <DocIcon />
                  <span className="doc-window-title">Proposal: {proposal.company_name || 'Untitled'}</span>
                </div>
                {docHeaderActions(
                  <button className="icon-btn" onClick={() => setDocExpanded(false)} title="Close">
                    <CloseIcon />
                  </button>,
                )}
              </div>
              <div className="doc-modal-body">{docBody}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MoreIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1 1" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1-1" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}
