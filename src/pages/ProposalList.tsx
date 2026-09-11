import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { ProposalRow } from '../lib/types'

type ListRow = Pick<
  ProposalRow,
  'id' | 'client_name' | 'company_name' | 'status' | 'updated_at' | 'missing_fields'
>

export function ProposalList() {
  const { role } = useAuth()
  const [rows, setRows] = useState<ListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('proposals')
      .select('id, client_name, company_name, status, updated_at, missing_fields')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setRows(data as ListRow[])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDelete(id: string) {
    setDeletingId(id)
    const { error: deleteError } = await supabase.from('proposals').delete().eq('id', id)
    setDeletingId(null)
    setConfirmId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Proposals</h1>
        <Link to="/new" className="btn primary">
          New proposal
        </Link>
      </div>

      {error && <div className="banner danger">{error}</div>}

      {rows === null && !error && <p className="empty-state">Loading…</p>}

      {rows && rows.length === 0 && (
        <p className="empty-state">No proposals yet. Start one from an intake call.</p>
      )}

      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Company</th>
              <th>Status</th>
              <th>Last touched</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.client_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td>{r.company_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td>
                  <span className={`status-pill ${r.status}`}>
                    {r.status === 'rejected' ? 'Changes requested' : r.status.replace('_', ' ')}
                  </span>
                  {r.missing_fields.length > 0 && (
                    <span className="status-pill" style={{ marginLeft: 6, color: 'var(--warning)', borderColor: 'var(--warning-border)' }}>
                      {r.missing_fields.length} missing
                    </span>
                  )}
                </td>
                <td>{new Date(r.updated_at).toLocaleString()}</td>
                <td>
                  <Link to={`/proposal/${r.id}`}>View</Link>
                  {role === 'reviewer' && r.status === 'in_review' && (
                    <>
                      {' · '}
                      <Link to={`/review/${r.id}`}>Review</Link>
                    </>
                  )}
                  {' · '}
                  {confirmId === r.id ? (
                    <span>
                      Delete?{' '}
                      <button
                        type="button"
                        className="link"
                        style={{ color: 'var(--danger)' }}
                        disabled={deletingId === r.id}
                        onClick={() => handleDelete(r.id)}
                      >
                        {deletingId === r.id ? 'Deleting…' : 'Yes'}
                      </button>
                      {' / '}
                      <button type="button" className="link" onClick={() => setConfirmId(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="link" style={{ color: 'var(--danger)' }} onClick={() => setConfirmId(r.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
