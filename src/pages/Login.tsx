import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signIn(email, password)
    setSubmitting(false)
    if (error) setError(error)
    // On success, AuthProvider's onAuthStateChange flips status to signed_in
    // and the router (below) re-renders past this screen.
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <img src="/favicon.png" alt="" width={40} height={40} />
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 600 }}>Proposally</h1>
        </div>
        <p className="muted" style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Sign in to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="banner danger">{error}</div>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {/* No sign-up affordance: sign-ups are disabled server-side, staff are provisioned by hand. */}
      </div>
    </div>
  )
}
