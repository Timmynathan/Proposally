import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  REGENERATION_MODEL,
  SECTION_KEYS,
  type SectionKey,
  buildVerbatimRulesText,
  buildFieldsBlock,
  missingRequiredFields,
  SECTION_INSTRUCTIONS,
  requiredFieldForSection,
  stripCodeFence,
  verifyField,
  markerFor,
  callClaude,
  restFetch,
  logEvent,
  fetchProposal,
  requiredEnv,
  type RestContext,
} from './_lib/proposals.js'

export const config = {
  maxDuration: 30,
}

function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === 'string' && (SECTION_KEYS as string[]).includes(v)
}

function buildSystemPrompt(sectionKey: SectionKey, missing: ReturnType<typeof missingRequiredFields>, steer: string): string {
  return `You write prose for client-facing sales proposals on behalf of Koya. You are regenerating ONE section of an existing proposal — "${sectionKey}" — not the whole document. Follow these rules exactly — they are not stylistic preferences:

${buildVerbatimRulesText(missing)}

Return ONLY a JSON object with exactly one string key, "${sectionKey}", and nothing else — no markdown code fences, no commentary before or after.

${sectionKey}: ${SECTION_INSTRUCTIONS[sectionKey]}${
    steer ? `\n\nAdditional guidance from the salesperson for this specific rewrite (follow it, but it never overrides the rules above): ${steer}` : ''
  }`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const env = requiredEnv()
  if (!env) {
    res.status(500).json({ ok: false, error: 'Server is missing required environment variables' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.status(401).json({ ok: false, error: 'Missing Authorization header' })
    return
  }

  const { proposalId, sectionKey, steer } = (req.body ?? {}) as {
    proposalId?: string
    sectionKey?: string
    steer?: string
  }
  if (!proposalId || !isSectionKey(sectionKey)) {
    res.status(400).json({ ok: false, error: 'proposalId and a valid sectionKey are required' })
    return
  }
  const steerText = (steer ?? '').trim().slice(0, 500)

  const ctx: RestContext = { url: env.supabaseUrl, anonKey: env.supabaseAnonKey, authHeader }

  const propResult = await fetchProposal(ctx, proposalId)
  if (!propResult.ok) {
    res.status(propResult.status).json({ ok: false, error: propResult.message })
    return
  }
  const proposal = propResult.proposal
  const missing = missingRequiredFields(proposal)
  const targetField = requiredFieldForSection(sectionKey)

  let content: string
  try {
    const rawText = await callClaude({
      apiKey: env.anthropicKey,
      model: REGENERATION_MODEL,
      maxTokens: 2000,
      system: buildSystemPrompt(sectionKey, missing, steerText),
      user: buildFieldsBlock(proposal),
      label: 'regenerate',
    })

    let parsed: Record<string, string>
    try {
      parsed = JSON.parse(stripCodeFence(rawText))
    } catch {
      console.error('[regenerate] Model text was not valid JSON. First 500 chars:', rawText.slice(0, 500))
      throw new Error(`Model output was not valid JSON (${rawText.length} chars received)`)
    }

    if (typeof parsed[sectionKey] !== 'string' || !parsed[sectionKey].trim()) {
      throw new Error(`Model response did not include a non-empty "${sectionKey}" key`)
    }

    content = parsed[sectionKey]
  } catch (err) {
    console.error('[regenerate] failed:', err)
    await logEvent(ctx, proposalId, 'section_regenerated', false, {
      section: sectionKey,
      message: err instanceof Error ? err.message : 'Unknown error calling Claude',
    })
    res.status(502).json({ ok: false, error: 'Could not get a valid response from Claude' })
    return
  }

  let warning: ReturnType<typeof verifyField> = null
  if (targetField) {
    if (missing.includes(targetField)) {
      content = `${markerFor(targetField)}\n\n${content}`
    } else {
      warning = verifyField(targetField, proposal[targetField]!, content)
    }
  }

  const now = new Date().toISOString()
  const patchRes = await restFetch(ctx, `/proposal_sections?proposal_id=eq.${proposalId}&key=eq.${sectionKey}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ content, generated_at: now, edited_by_human: false }),
  })

  if (!patchRes.ok) {
    const errBody = await patchRes.json().catch(() => ({ message: patchRes.statusText }))
    const message = (errBody as { message?: string }).message ?? 'Unknown update error'
    await logEvent(ctx, proposalId, 'section_regenerated', false, { section: sectionKey, message })
    res.status(500).json({ ok: false, error: `Failed to save section: ${message}` })
    return
  }

  const updatedRows = (await patchRes.json()) as { id: string; key: string; content: string | null; position: number }[]
  if (updatedRows.length === 0) {
    // FIELD_TARGETS/PATCH matched no row — the section doesn't exist yet, meaning
    // the full generate.ts run that creates all six rows hasn't happened.
    await logEvent(ctx, proposalId, 'section_regenerated', false, {
      section: sectionKey,
      message: 'No existing section row to update — run full generation first.',
    })
    res.status(409).json({ ok: false, error: 'This proposal has no sections yet — generate the full proposal first.' })
    return
  }

  await logEvent(ctx, proposalId, 'section_regenerated', true, {
    section: sectionKey,
    model: REGENERATION_MODEL,
    warning,
  })

  if (warning) {
    await logEvent(ctx, proposalId, 'verbatim_check_failed', false, warning)
  }

  res.status(200).json({ ok: true, section: updatedRows[0], warning })
}
