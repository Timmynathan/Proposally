import type { ProposalRow } from './types'

// The "user message" bubble on the proposal page — the full prompt, close to
// verbatim field content rather than a paraphrase. Each field gets its own
// paragraph (not stitched into one sentence with periods) specifically to
// avoid grammar breakage: a field that already ends in its own punctuation,
// or spans multiple lines (recommended_services is often a bulleted list),
// would otherwise collide with a template period right after it.
export function buildFullPrompt(p: ProposalRow): string {
  const scope = p.project_scope?.trim() || '(project scope not yet provided)'
  const services = p.recommended_services?.trim() || '(deliverables not yet provided)'
  const timeline = p.proposed_timeline?.trim() || '(timeline not yet provided)'
  const pricing = p.estimated_pricing?.trim() || '(pricing not yet provided)'

  return [
    `Create a comprehensive business proposal regarding ${scope}`,
    `The scope includes: ${services}`,
    `The timeline is: ${timeline}`,
    `The total budget is: ${pricing}`,
    `Please structure it with an executive summary, methodology, timeline, pricing, and next steps.`,
  ].join('\n\n')
}

// The opening line of Proposally's reply — not a call to Claude, and not the
// real system prompt (see api/_lib/proposals.ts for that). Deliberately
// doesn't claim to "research" or "look into" anything the app doesn't
// actually do — it just describes the assembly work that's really happening.
export function buildNarration(p: ProposalRow): string {
  const company = p.company_name?.trim() || 'the client'
  return `I'm starting work on the proposal for ${company}. I'll pull together the scope, timeline, and pricing you've shared to make this clear and compelling, then draft the full proposal document.`
}
