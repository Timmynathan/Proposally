import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'

const root = createRoot(document.getElementById('root')!)

const missingEnv = !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY

// App.tsx (transitively) imports src/lib/supabase.ts, which throws if these are
// unset. That throw happens at module-evaluation time, before React ever calls
// render() — so a normal static `import App from './App'` above would crash the
// page to blank with the real error visible only in the browser console. Checking
// first and importing App dynamically only when config is present turns that into
// a visible on-page message instead.
if (missingEnv) {
  root.render(
    <div style={{ maxWidth: 480, margin: '15vh auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.3rem' }}>Missing configuration</h1>
      <p>
        <code>VITE_SUPABASE_URL</code> and/or <code>VITE_SUPABASE_ANON_KEY</code> are not set.
      </p>
      <p>
        Fill them into <code>.env</code> at the project root with your Supabase project's URL and
        anon key, then restart the dev server.
      </p>
    </div>,
  )
} else {
  import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    )
  })
}
