// Shared between generate.ts and regenerate.ts. Underscore-prefixed folder so
// Vercel's filesystem routing does not turn this into its own endpoint.

// --- Model choices -----------------------------------------------------------
//
// Sonnet for the initial six-section generation: client-facing commercial prose
// that carries the company's name, written at low volume, with a salesperson
// waiting on the result. Prose quality is the product, and a few extra seconds
// of latency is a fair trade for materially better first-draft writing.
export const GENERATION_MODEL = 'claude-sonnet-5'

// Haiku for single-section regeneration: the ask is narrower (one section, often
// with a short steer comment), it happens more often per proposal as a
// salesperson iterates, and the salesperson is actively waiting on each click —
// fast and cheap wins over first-draft polish here.
export const REGENERATION_MODEL = 'claude-haiku-4-5-20251001'

const ANTHROPIC_VERSION = '2023-06-01'

export type SectionKey =
  | 'introduction'
  | 'proposed_solution'
  | 'deliverables'
  | 'timeline'
  | 'pricing'
  | 'next_steps'

export const SECTION_KEYS: SectionKey[] = [
  'introduction',
  'proposed_solution',
  'deliverables',
  'timeline',
  'pricing',
  'next_steps',
]

export type RequiredField = 'project_scope' | 'recommended_services' | 'proposed_timeline' | 'estimated_pricing'

export const REQUIRED_FIELDS: RequiredField[] = [
  'project_scope',
  'recommended_services',
  'proposed_timeline',
  'estimated_pricing',
]

// Where each required field's verbatim text is expected to land, and how strictly
// to check it. `exact` = the whole field must appear as one contiguous run of text
// (whitespace-normalized). `itemwise` = the field is checked item by item, because
// recommended_services is explicitly allowed to be *reformatted* into a bulleted
// deliverables list (handoff section 4.2) — a structural change that is not the
// same thing as rewording. Splitting the check by item still catches the failure
// mode that matters: any individual item's wording being changed.
export const FIELD_TARGETS: Record<RequiredField, { section: SectionKey; mode: 'exact' | 'itemwise'; label: string }> = {
  project_scope: { section: 'proposed_solution', mode: 'exact', label: 'Project scope' },
  recommended_services: { section: 'deliverables', mode: 'itemwise', label: 'Recommended services / deliverables' },
  proposed_timeline: { section: 'timeline', mode: 'exact', label: 'Timeline' },
  estimated_pricing: { section: 'pricing', mode: 'exact', label: 'Pricing' },
}

export interface ProposalRecord {
  id: string
  client_name: string | null
  client_email: string | null
  company_name: string | null
  date_of_call: string | null
  salesperson_name: string | null
  client_needs_summary: string | null
  project_scope: string | null
  goals_and_objectives: string | null
  recommended_services: string | null
  proposed_timeline: string | null
  estimated_pricing: string | null
  supporting_material: string | null
  missing_fields: string[]
  status: string
  share_token: string
  sent_at: string | null
}

export interface VerificationWarning {
  field: RequiredField
  section: SectionKey
  detail: string
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// Splits a multi-item field into individual deliverables for itemwise checking.
// The form's hint asks for one per line, but a single line separated by " / "
// is a realistic alternative someone will actually type — split on that too
// when there's only one line, rather than treating the whole line as one item
// and flagging correctly-reformatted output as a false verbatim failure.
export function splitItems(value: string): string[] {
  const byNewline = value.split('\n').map(normalizeWhitespace).filter((l) => l.length > 0)
  if (byNewline.length > 1) return byNewline
  const bySlash = value.split(/\s*\/\s*/).map(normalizeWhitespace).filter((l) => l.length > 0)
  return bySlash.length > 1 ? bySlash : byNewline
}

export function verifyField(field: RequiredField, value: string, sectionContent: string): VerificationWarning | null {
  const target = FIELD_TARGETS[field]
  const haystack = normalizeWhitespace(sectionContent)

  if (target.mode === 'exact') {
    const needle = normalizeWhitespace(value)
    if (!haystack.includes(needle)) {
      return {
        field,
        section: target.section,
        detail: `Expected "${needle}" to appear verbatim in the ${target.section} section, but it does not.`,
      }
    }
    return null
  }

  const items = splitItems(value)
  const missingItems = items.filter((item) => !haystack.includes(item))
  if (missingItems.length > 0) {
    return {
      field,
      section: target.section,
      detail: `${missingItems.length} of ${items.length} item(s) from ${field} do not appear verbatim in the ${target.section} section: ${missingItems.join(' | ')}`,
    }
  }
  return null
}

export function markerFor(field: RequiredField): string {
  return `[ ${FIELD_TARGETS[field].label} not provided — to be confirmed ]`
}

export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

// The rules block shared by both the full six-section prompt and the single-
// section regeneration prompt. Kept in one place so a rule change (or a fix
// like the project_scope splicing bug) only has to happen once.
export function buildVerbatimRulesText(missing: RequiredField[]): string {
  const missingLabels = missing.map((f) => FIELD_TARGETS[f].label)
  return `1. VERBATIM FIELDS. project_scope, recommended_services, proposed_timeline and estimated_pricing (whichever are supplied below) must be reproduced in your prose EXACTLY as given: the same words, numbers, punctuation and currency formatting. Do not reword, paraphrase, round, summarize, abbreviate, or "clean up" them. recommended_services may be formatted as a list (one supplied item per bullet) but each item's wording must stay unchanged. The other three should be woven into natural sentences without altering a single word of the supplied text.

2. NEVER INVENT A COMMITMENT. No number, date, duration, deliverable, guarantee, discount or capability that is not present in the fields supplied to you.${
    missingLabels.length > 0
      ? ` The following required fields are MISSING and were NOT supplied: ${missingLabels.join(', ')}. Do not state, estimate, imply, or guess a value for any of them. Write the surrounding prose in general terms that do not depend on that missing information — do not say things like "typically a few weeks" or invent a placeholder figure. It is correct and expected to simply not mention a specific figure for a missing field.`
      : ' All required fields were supplied for this proposal.'
  }

3. NO COMPANY CLAIMS. Do not claim any experience, client roster, certifications, awards, or past results for Koya. None of that is supplied to you, so none of it may appear.

4. TONE. Professional and warm, not effusive. No superlatives — avoid words like "cutting-edge", "revolutionary", "world-class", "game-changing".

5. SUPPORTING MATERIAL. If supplied, use it only as background context for specificity in your phrasing. It is never a source of new commitments, numbers, or deliverables.`
}

// Per-section content instructions, shared by the full six-section prompt
// (generate.ts) and the single-section prompt (regenerate.ts) so the two never
// drift out of sync with each other.
export const SECTION_INSTRUCTIONS: Record<SectionKey, string> = {
  introduction:
    'thank the client for the call, address their summarized needs, express genuine interest in supporting them, note the recommended approach should help with their stated goals.',
  proposed_solution:
    "open by stating the project scope EXACTLY as supplied, word for word with no paraphrasing, as a natural opening statement of what this engagement covers. Then write prose about the recommended approach and why it fits. Close with a line about this being practical for the client's current systems, team capacity, and goals.",
  deliverables: 'a clear rendering of the recommended services/deliverables.',
  timeline: 'prose introducing the timeline, mentioning that the engagement includes implementation, testing, and a feedback/iteration period.',
  pricing: 'prose introducing the pricing, noting that scope changes will be discussed and adjusted together.',
  next_steps: 'invite the client to formalize the agreement, invite questions, close warmly ("looking forward to working together" in your own words).',
}

// The one required field (if any) whose verbatim text is expected inside a given
// section — the inverse of FIELD_TARGETS. introduction/next_steps have none.
export function requiredFieldForSection(section: SectionKey): RequiredField | undefined {
  return REQUIRED_FIELDS.find((f) => FIELD_TARGETS[f].section === section)
}

export function buildFieldsBlock(p: ProposalRecord): string {
  const lines: string[] = []
  const push = (label: string, value: string | null) => {
    lines.push(`${label}: ${value && value.trim() ? value : '(not supplied)'}`)
  }
  push('Client name', p.client_name)
  push('Company name', p.company_name)
  push("Summary of client's needs", p.client_needs_summary)
  push('Goals and objectives', p.goals_and_objectives)
  push('Project scope', p.project_scope)
  push('Recommended services / deliverables', p.recommended_services)
  push('Proposed timeline', p.proposed_timeline)
  push('Estimated pricing', p.estimated_pricing)
  if (p.supporting_material && p.supporting_material.trim()) {
    push('Supporting material (context only, not a source of commitments)', p.supporting_material)
  }
  return lines.join('\n')
}

export function missingRequiredFields(p: ProposalRecord): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => !p[f] || !p[f]!.trim())
}

// The exact system prompt used for a full six-section generation. Exported
// (not private to generate.ts) so api/kickoff.ts can show the user the real
// prompt before the real call runs, rather than a second hand-written copy
// that could quietly drift out of sync with what's actually sent.
export function buildGenerationSystemPrompt(missing: RequiredField[]): string {
  return `You write prose for client-facing sales proposals on behalf of Koya. You are given facts collected on a discovery call. Follow these rules exactly — they are not stylistic preferences:

${buildVerbatimRulesText(missing)}

Return ONLY a JSON object with exactly these six string keys and nothing else — no markdown code fences, no commentary before or after: introduction, proposed_solution, deliverables, timeline, pricing, next_steps.

${SECTION_KEYS.map((k) => `${k}: ${SECTION_INSTRUCTIONS[k]}`).join('\n')}`
}

// A user message can be plain text (the common case) or a mix of text and
// images — extraction uses the array form so a photo of a whiteboard or
// document can sit alongside typed/extracted text in the same request.
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

// Calls Claude, returning the text content (skipping any `thinking` block —
// Sonnet defaults to extended thinking, which puts a `thinking` block before
// the `text` block in the content array, so content[0] is not reliably the
// answer). Throws with a descriptive message on any failure; caller decides
// how to log/respond.
export async function callClaude(params: {
  apiKey: string
  model: string
  maxTokens: number
  system: string
  user: string | ClaudeContentBlock[]
  label: string
}): Promise<string> {
  const startedAt = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  })

  const elapsedMs = Date.now() - startedAt
  console.log(`[${params.label}] Anthropic responded status=${res.status} in ${elapsedMs}ms`)

  if (!res.ok) {
    const errBody = await res.text()
    console.error(`[${params.label}] Anthropic error body:`, errBody.slice(0, 2000))
    throw new Error(`Anthropic API error ${res.status}`)
  }

  const rawBody = await res.text()
  console.log(`[${params.label}] raw body length=${rawBody.length}`)

  let data: { content?: { type?: string; text?: string }[] }
  try {
    data = JSON.parse(rawBody)
  } catch {
    console.error(`[${params.label}] Anthropic body was not valid JSON. First 500 chars:`, rawBody.slice(0, 500))
    throw new Error(`Anthropic response body was not valid JSON (${rawBody.length} bytes received)`)
  }

  const textBlock = data.content?.find((block) => block.type === 'text')
  const rawText = textBlock?.text ?? ''
  if (!rawText) {
    console.error(`[${params.label}] No text block in Anthropic response`)
    throw new Error('No text content in Anthropic response')
  }
  return rawText
}

export interface RestContext {
  url: string
  anonKey: string
  authHeader: string
}

export async function restFetch(ctx: RestContext, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ctx.url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: ctx.anonKey,
      Authorization: ctx.authHeader,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export async function logEvent(
  ctx: RestContext,
  proposalId: string,
  event: string,
  ok: boolean,
  detail: unknown,
): Promise<void> {
  await restFetch(ctx, '/proposal_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ proposal_id: proposalId, event, ok, detail }),
  })
}

export async function fetchProposal(
  ctx: RestContext,
  proposalId: string,
): Promise<{ ok: true; proposal: ProposalRecord } | { ok: false; status: number; message: string }> {
  const res = await restFetch(ctx, `/proposals?id=eq.${proposalId}&select=*`, {
    headers: { Accept: 'application/vnd.pgrst.object+json' },
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ message: res.statusText }))
    return {
      ok: false,
      status: res.status === 406 ? 404 : res.status,
      message: (errBody as { message?: string }).message ?? 'Proposal not found',
    }
  }
  const proposal = (await res.json()) as ProposalRecord
  return { ok: true, proposal }
}

// Read env vars every function needs. Throws if any are missing so callers can
// fail fast with one check instead of repeating the null-guard everywhere.
export function requiredEnv() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!anthropicKey || !supabaseUrl || !supabaseAnonKey) {
    return null
  }
  return { anthropicKey, supabaseUrl, supabaseAnonKey }
}
