import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { StaffRole } from './types'

type AuthStatus = 'checking' | 'signed_out' | 'signed_in'

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  role: StaffRole | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<StaffRole | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadRole(userId: string) {
      const { data } = await supabase
        .from('staff')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle()
      if (!cancelled) setRole((data?.role as StaffRole) ?? null)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setStatus(data.session ? 'signed_in' : 'signed_out')
      if (data.session) loadRole(data.session.user.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      setStatus(newSession ? 'signed_in' : 'signed_out')
      if (newSession) {
        loadRole(newSession.user.id)
      } else {
        setRole(null)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    // One generic message regardless of cause — wrong password, unknown email, disabled
    // account all look the same from outside, so the form can't be used to enumerate
    // which addresses have accounts.
    if (error) return { error: 'Email or password is incorrect.' }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ status, session, role, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
