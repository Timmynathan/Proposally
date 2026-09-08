import { useState, type ReactNode } from 'react'
import { Routes, Route, Link, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { Login } from './pages/Login'
import { ProposalList } from './pages/ProposalList'
import { IntakeForm } from './pages/IntakeForm'
import { ProposalView } from './pages/ProposalView'
import { ReviewScreen } from './pages/ReviewScreen'
import { PublicProposal } from './pages/PublicProposal'
import { Account } from './pages/Account'

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  // While checking, render a neutral placeholder — never the login form, which
  // would flash on every reload and look broken.
  if (status === 'checking') {
    return <div className="app-shell" />
  }

  if (status === 'signed_out') {
    return <Login />
  }

  return <>{children}</>
}

function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div className="announcement-banner">
      <span>Impressive proposals in minutes with Proposally's AI Proposal Generator.</span>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  return (
    <div className="app-shell">
      {status === 'signed_in' && (
        <div className="chrome-top">
        <AnnouncementBanner />
        <div className="top-nav">
          <Link to="/" className="brand">
            <img src="/favicon.png" alt="" height={48} />
            <span>Proposally</span>
          </Link>
          <div className="top-nav-inner">
            <nav>
              {/* No Templates page exists yet — placeholder link until one does. */}
              <Link to="/" className="nav-link">Templates</Link>
              <Link to="/proposals" className="nav-link">All proposals</Link>
              <Link to="/account" className="nav-avatar" title="Account">
                <UserIcon />
              </Link>
            </nav>
          </div>
        </div>
        </div>
      )}
      {children}
    </div>
  )
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 20c0-4.418 3.582-7 8-7s8 2.582 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function StaffRoutes() {
  return (
    <RequireAuth>
      <Shell>
        <Routes>
          <Route path="/" element={<IntakeForm />} />
          <Route path="/new" element={<IntakeForm />} />
          <Route path="/proposals" element={<ProposalList />} />
          <Route path="/proposal/:id" element={<ProposalView />} />
          <Route path="/review/:id" element={<ReviewScreen />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </RequireAuth>
  )
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public, token-gated, no auth — must sit outside RequireAuth/AuthProvider's
            gate entirely, since the client viewing this never signs in. */}
        <Route path="/p/:token" element={<PublicProposal />} />
        <Route path="/*" element={<StaffRoutes />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
