import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { SECTION_KEYS, type ProposalRow, type ProposalSectionRow, type ProposalApprovalRow } from '../lib/types'
import { SectionContent } from '../lib/SectionContent'

// Reviewer-only decision screen. The role check here is a UI convenience —
// the actual gate is enforced twice over, regardless of what this screen
// shows or hides: api/decide.ts checks the caller's role in `staff` before
// writing anything, and the "reviewers write approvals" RLS policy (Phase 2
// migration) rejects the insert at the database layer even if that check
// were somehow bypassed.
export function ReviewScreen() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const [proposal, setProposal] = useState<ProposalRow | null>(null)
  const [sections, setSections] = useState<ProposalSectionRow[]>([])
  const [approvals, setApprovals] = useState<ProposalApprovalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [{ data: p }, { data: s }, { data: a }] = await Promise.all([
      supabase.from('proposals').select('*').eq('id', id).single(),
      supabase.from('proposal_sections').select('*').eq('proposal_id', id).order('position'),
      supabase.from('proposal_approvals').select('*').eq('proposal_id', id).order('decided_at', { ascending: false }),
    ])
    setProposal(p as ProposalRow)
    setSections((s as ProposalSectionRow[]) ?? [])
    setApprovals((a as ProposalApprovalRow[]) ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function decide(decision: 'approved' | 'rejected') {
    if (!id) return
    if (decision === 'rejected' && !comment.trim()) {
      setError('A comment is required when rejecting, so the salesperson knows what to fix.')
      return
    }
    setBusy(decision === 'approved' ? 'approve' : 'reject')
    setError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const res = await fetch('/api/decide', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ proposalId: id, decision, comment: comment.trim() || null }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError(body.error ?? `Decision failed (${res.status})`)
        return
      }
      setComment('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision request failed')
    } finally {
      setBusy(null)
      await load()
    }
  }

  if (loading) return <p className="empty-state">Loading…</p>
  if (!proposal) return <p className="empty-state">Proposal not found.</p>

  if (role !== 'reviewer') {
    return (
      <div>
        <Link to="/proposals">&larr; All proposals</Link>
        <div className="banner danger" style={{ marginTop: 16 }}>
          This screen is for reviewers only. Your account isn't provisioned with the reviewer role.
        </div>
      </div>
    )
  }

  const canDecide = proposal.status === 'in_review'

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/proposals">&larr; All proposals</Link>
      </div>

      <h1>
        Review: {proposal.company_name || 'Untitled'} — {proposal.client_name || 'Unnamed client'}
      </h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        <span className={`status-pill ${proposal.status}`}>{proposal.status.replace('_', ' ')}</span>
        {'  '}Prepared by {proposal.salesperson_name || '—'} · {proposal.date_of_call || 'no date'}
      </p>

      {proposal.missing_fields.length > 0 && (
        <div className="banner warning" style={{ marginBottom: 16 }}>
          Missing required fields: {proposal.missing_fields.join(', ')}. You can still approve, but
          the database will refuse to let this be sent to the client until these are filled in.
        </div>
      )}

      {error && <div className="banner danger" style={{ marginBottom: 16 }}>{error}</div>}

      {approvals.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Decision history</h3>
          {approvals.map((a) => (
            <p key={a.id} style={{ margin: '4px 0', fontSize: '0.9rem' }}>
              <strong>{a.decision}</strong> — {new Date(a.decided_at).toLocaleString()}
              {a.comment ? ` — "${a.comment}"` : ''}
            </p>
          ))}
        </div>
      )}

      {SECTION_KEYS.map((key) => {
        const section = sections.find((s) => s.key === key)
        return (
          <div className="section-block" key={key}>
            <h3>{key.replace('_', ' ')}</h3>
            <SectionContent content={section?.content} />
          </div>
        )
      })}

      {canDecide && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3>Decision</h3>
          <div className="field">
            <label htmlFor="comment">Comment (required for rejection, optional for approval)</label>
            <textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="primary" onClick={() => decide('approved')} disabled={busy !== null}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button onClick={() => decide('rejected')} disabled={busy !== null}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {!canDecide && proposal.status !== 'draft' && (
        <p style={{ color: 'var(--text-muted)', marginTop: 24 }}>
          This proposal isn't awaiting review (status: {proposal.status.replace('_', ' ')}).
        </p>
      )}
    </div>
  )
}
