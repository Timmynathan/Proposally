# Proposally

An AI-powered sales proposal generator. You describe a deal (type it, paste notes, attach a document or photo, or speak it), Proposally extracts the commercial details and drafts a full client-facing proposal — introduction, proposed solution, deliverables, timeline, pricing, and next steps — which then goes through review, approval, and sending.

Built as a course project, with two rules treated as non-negotiable throughout:

1. **Claude writes prose, never commitments.** Price, timeline, scope, and services are reproduced verbatim from what was actually supplied — never reworded, rounded, or invented — and every generated proposal is checked in code against the source fields before it's saved.
2. **A gap stays a gap.** A missing required field renders as a visible marker, never a plausible-sounding guess, and sending is blocked at the database level (a Postgres trigger, not just a UI check) until it's filled in.

## How it works

1. **Describe it** — a single composer bar (type a description, attach files/photos, or use live browser speech-to-text) replaces a traditional intake form. Multiple sources can be combined in one go.
2. **Review the extracted fields** — Claude pulls the commercial details out of whatever you gave it into an editable set of fields, with anything it couldn't find left visibly blank rather than guessed.
3. **Generate** — Claude drafts the six proposal sections from those fields, and the result is verified in code to confirm every commitment made it into the document unchanged.
4. **Review → approve → send** — a reviewer can approve or reject with a comment; once approved, the proposal is emailed to the client with a link to a public, token-gated proposal page, and can be downloaded as PDF, Word (.docx), or Markdown.

## Tech stack

- **Frontend:** Vite + React 19 + TypeScript, plain CSS (no framework)
- **Backend:** Vercel serverless functions (`api/*.ts`)
- **Database/auth:** Supabase (Postgres, Auth, Row Level Security, a security-definer function for the public share link, and a trigger enforcing the approval/missing-fields gate before send)
- **AI:** Anthropic Claude (Sonnet for generation, Haiku for field extraction — including reading photos of documents via vision)
- **Email:** Resend
- **PDF:** `@react-pdf/renderer`; **Word export:** `docx`

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in real values (Supabase project URL/anon key, an Anthropic API key, a Resend API key).
3. In the Supabase SQL editor, run the three migration files in order: `supabase/schema.sql`, `supabase/phase2-migration.sql`, `supabase/phase3-delete-policy.sql`.
4. `vercel dev` — serves the app and the `/api/*` functions together on `http://localhost:3000` (not Vite's default port, since the API routes need to be reachable too).

## Project structure

- `src/pages/` — the app's screens: intake/composer, proposal view (chat-style generation + document), reviewer screen, account, public client-facing page
- `src/lib/` — shared UI pieces and helpers (document header, PDF/DOCX/Markdown export, prompt text builders)
- `api/` — serverless functions: `extract` (fields from text/files/photos), `generate`, `regenerate` (single section), `pdf`, `send`
- `supabase/` — schema and migrations (run manually in the SQL editor; not executed by the app)
