import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export function Account() {
  const { session, role, signOut } = useAuth()
  const [displayName, setDisplayName] = useState<string | null>(null)

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    supabase
      .from('staff')
      .select('display_name')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name ?? null))
  }, [session?.user.id])

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/proposals">&larr; All proposals</Link>
      </div>

      <h1>Account</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 24 }}>
        Your account details, as provisioned by an admin.
      </p>

      <div className="card" style={{ maxWidth: 420 }}>
        <div className="field">
          <label>Name</label>
          <p style={{ margin: '2px 0 0' }}>{displayName ?? <span style={{ color: 'var(--text-muted)' }}>Not set</span>}</p>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label>Email</label>
          <p style={{ margin: '2px 0 0' }}>{session?.user.email}</p>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label>Role</label>
          <p style={{ margin: '2px 0 0', textTransform: 'capitalize' }}>
            {role ?? <span style={{ color: 'var(--text-muted)' }}>Not assigned</span>}
          </p>
        </div>
      </div>

      <button onClick={signOut} style={{ marginTop: 24 }}>
        Sign out
      </button>
    </div>
  )
}
