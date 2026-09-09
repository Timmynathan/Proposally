import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  GENERATION_MODEL,
  SECTION_KEYS,
  type SectionKey,
  FIELD_TARGETS,
  REQUIRED_FIELDS,
  buildFieldsBlock,
  buildGenerationSystemPrompt,
  missingRequiredFields,
  stripCodeFence,
  verifyField,
  markerFor,
  callClaude,
  restFetch,
  logEvent,
  fetchProposal,
  requiredEnv,
  type RestContext,
  type VerificationWarning,
} from './_lib/proposals.js'

// A full six-section generation with Sonnet routinely takes 30-60s (confirmed by
// direct testing — a similarly-sized call took ~30s outside this function).
// Vercel's default Serverless Function timeout is 10s, which is well short of
// that: the outbound call to Claude gets torn down mid-response, and what's left
// fails JSON parsing with an opaque "Unexpected end of JSON input" — nothing to
// do with the generation logic. This raises the ceiling for this function only.
export const config = {
  maxDuration: 60,
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

  const { proposalId } = (req.body ?? {}) as { proposalId?: string }
  if (!proposalId) {
    res.status(400).json({ ok: false, error: 'proposalId is required' })
    return
  }

  // Scoped to the caller's own session token, not a service-role key — this way
  // the request runs as the signed-in user and is subject to the same RLS
  // policies as everything else they do. No secret bypass key needed.
  const ctx: RestContext = { url: env.supabaseUrl, anonKey: env.supabaseAnonKey, authHeader }

  const propResult = await fetchProposal(ctx, proposalId)
  if (!propResult.ok) {
    res.status(propResult.status).json({ ok: false, error: propResult.message })
    return
  }
  const proposal = propResult.proposal
  const missing = missingRequiredFields(proposal)

  let modelJson: Record<SectionKey, string>
  try {
    const rawText = await callClaude({
      apiKey: env.anthropicKey,
      model: GENERATION_MODEL,
      // Sonnet can spend a chunk of this budget on internal reasoning before
      // writing the six sections themselves — 3000 was tight enough that a
      // real generation call hit max_tokens with zero text output. Sized well
      // above the actual six-section prose length to leave headroom for that.
      maxTokens: 8000,
      system: buildGenerationSystemPrompt(missing),
      user: buildFieldsBlock(proposal),
      label: 'generate',
    })

    let parsed: Record<string, string>
    try {
      parsed = JSON.parse(stripCodeFence(rawText))
    } catch {
      console.error('[generate] Model text was not valid JSON. First 500 chars:', rawText.slice(0, 500))
      throw new Error(`Model output was not valid JSON (${rawText.length} chars received)`)
    }

    const missingKeys = SECTION_KEYS.filter((k) => typeof parsed[k] !== 'string' || !parsed[k].trim())
    if (missingKeys.length > 0) {
      await logEvent(ctx, proposalId, 'generated', false, {
        message: `Model response missing sections: ${missingKeys.join(', ')}`,
        raw: rawText.slice(0, 2000),
      })
      res.status(502).json({ ok: false, error: `Model response was missing sections: ${missingKeys.join(', ')}` })
      return
    }

    modelJson = parsed as Record<SectionKey, string>
  } catch (err) {
    console.error('[generate] failed:', err)
    await logEvent(ctx, proposalId, 'generated', false, {
      message: err instanceof Error ? err.message : 'Unknown error calling Claude',
    })
    res.status(502).json({ ok: false, error: 'Could not get a valid response from Claude' })
    return
  }

  // Insert visible markers for missing required fields, at the top of the section
  // where that field's content would otherwise appear. This is done in code, not
  // by the model — the model was only told to write around the gap, not to mark it.
  for (const field of missing) {
    const target = FIELD_TARGETS[field]
    modelJson[target.section] = `${markerFor(field)}\n\n${modelJson[target.section]}`
  }

  // The verification that actually enforces rule 1: for every verbatim field that
  // WAS supplied, confirm its exact text survived into the section untouched.
  const warnings: VerificationWarning[] = []
  for (const field of REQUIRED_FIELDS) {
    if (missing.includes(field)) continue
    const value = proposal[field]!
    const target = FIELD_TARGETS[field]
    const warning = verifyField(field, value, modelJson[target.section])
    if (warning) warnings.push(warning)
  }

  const now = new Date().toISOString()
  const sectionRows = SECTION_KEYS.map((key, position) => ({
    proposal_id: proposalId,
    key,
    position,
    content: modelJson[key],
    generated_at: now,
    edited_by_human: false,
  }))

  const upsertRes = await restFetch(ctx, '/proposal_sections?on_conflict=proposal_id,key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(sectionRows),
  })

  if (!upsertRes.ok) {
    const errBody = await upsertRes.json().catch(() => ({ message: upsertRes.statusText }))
    const message = (errBody as { message?: string }).message ?? 'Unknown upsert error'
    await logEvent(ctx, proposalId, 'generated', false, { message })
    res.status(500).json({ ok: false, error: `Failed to save sections: ${message}` })
    return
  }

  const savedSections = await upsertRes.json()

  await logEvent(ctx, proposalId, 'generated', true, {
    model: GENERATION_MODEL,
    missing_fields: missing,
    warnings,
  })

  // Verification failures are surfaced, not silently repaired: content is saved
  // as the model returned it (plus the code-inserted missing-field markers), and
  // every failed field gets its own ok=false event row for the audit trail.
  for (const warning of warnings) {
    await logEvent(ctx, proposalId, 'verbatim_check_failed', false, warning)
  }

  res.status(200).json({ ok: true, sections: savedSections, warnings })
}
