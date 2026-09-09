import type { VercelRequest, VercelResponse } from '@vercel/node'
import { extractTextFromFile, MAX_FILE_BYTES, SUPPORTED_EXTENSIONS } from './_lib/fileExtract.js'
import { callClaude, stripCodeFence, type ClaudeContentBlock } from './_lib/proposals.js'

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function imageMediaType(filename: string): string | null {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return null
  return IMAGE_MEDIA_TYPES[filename.slice(dot).toLowerCase()] ?? null
}

export const config = {
  maxDuration: 45,
}

// Mechanical extraction (PDF/DOCX -> text) is deterministic and needs no model.
// Mapping that raw text onto structured fields is inherently interpretive —
// this is Haiku, not Sonnet, because unlike generate.ts's final output, this
// result is never saved directly: it only pre-fills the intake form, and a
// human reviews and can correct every field before anything is stored. Given
// that human checkpoint, fast/cheap wins over first-pass polish, and a
// near-instant response matters more for an "upload and see fields populate"
// interaction than it does for finished client-facing prose.
const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

const INTAKE_FIELD_KEYS = [
  'client_name',
  'client_email',
  'company_name',
  'date_of_call',
  'salesperson_name',
  'client_needs_summary',
  'project_scope',
  'goals_and_objectives',
  'recommended_services',
  'proposed_timeline',
  'estimated_pricing',
  'supporting_material',
] as const

type IntakeFieldKey = (typeof INTAKE_FIELD_KEYS)[number]

const REQUIRED_COMMITMENT_KEYS: IntakeFieldKey[] = [
  'project_scope',
  'recommended_services',
  'proposed_timeline',
  'estimated_pricing',
]

const MAX_COMBINED_CHARS = 30000

interface UploadedFile {
  name: string
  base64: string
}

function buildSystemPrompt(): string {
  return `You extract structured intake information from raw meeting notes, project briefs, old proposal documents, a salesperson's own typed description, and/or photos of documents or whiteboards, for a sales team preparing a new client proposal.

Return ONLY a JSON object with exactly these string keys, nothing else — no markdown fences, no commentary: ${INTAKE_FIELD_KEYS.join(', ')}.

Field meanings:
- client_name: the client contact's name
- client_email: the client contact's email address
- company_name: the client's company or organization
- date_of_call: the date of the discovery call, in YYYY-MM-DD format, ONLY if a full date including the year is stated. If a date is mentioned without a year (e.g. "March 3rd", "last Tuesday"), leave this field EMPTY — do not assume the current year or any other year. A guessed year is a fabricated fact, not a formatting convenience.
- salesperson_name: the person from our side who ran the call or owns the proposal
- client_needs_summary: a short summary of the problem the client wants solved
- goals_and_objectives: the outcomes the client wants (revenue, efficiency, less manual work, etc.)
- supporting_material: any other useful contextual detail from the source text that doesn't fit the fields above but would help someone writing the proposal (existing tools/systems mentioned, team size, constraints, quotes) — a short summary, not a full transcript

Four fields carry commercial commitment and need extra care — project_scope, recommended_services, proposed_timeline, estimated_pricing:
- Extract them using the EXACT wording found in the source text — do not paraphrase, round, summarize, or "clean up" the phrasing. Copy the relevant sentence or phrase as it appears.
- If a field is genuinely not stated anywhere in the source text, return an empty string "" for it. Do NOT infer, estimate, or guess a plausible value. A missing price or timeline must come back empty, not filled with something reasonable-sounding — someone will review this before it becomes a real commitment, and a plausible-looking guess is more dangerous than an obvious blank.
- If the source mentions multiple candidate numbers or dates for the same field, prefer the one most clearly tied to that meaning (e.g. a price explicitly next to "quote" or "estimate" over an unrelated number), and when genuinely ambiguous, leave it empty rather than picking one.
- project_scope and recommended_services often overlap in freeform notes — the same sentence describing what to build IS both the scope and the deliverable. When the source describes specific things to build/deliver, extract that wording into BOTH fields rather than leaving recommended_services empty just because there's no separately labeled "services" list. If there are multiple distinct deliverables, put recommended_services as one item per line. Still verbatim, still empty if the source truly describes nothing buildable.

For every field, if the source text doesn't contain the information, return an empty string. Never fabricate a value for any field, not just the four commitment fields above.`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    res.status(500).json({ ok: false, error: 'Server is missing required environment variables' })
    return
  }

  // Not used for any database call here (there's no proposal yet to scope RLS
  // to) — just a soft deterrent against anonymous requests hitting a
  // Claude-calling endpoint. Every real call from the app carries one.
  if (!req.headers.authorization) {
    res.status(401).json({ ok: false, error: 'Missing Authorization header' })
    return
  }

  const { files, description } = (req.body ?? {}) as { files?: UploadedFile[]; description?: string }
  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if ((!Array.isArray(files) || files.length === 0) && !trimmedDescription) {
    res.status(400).json({ ok: false, error: 'Type a description or attach at least one file/photo' })
    return
  }

  const extractedTexts: string[] = []
  const imageBlocks: ClaudeContentBlock[] = []
  for (const file of files ?? []) {
    let buffer: Buffer
    try {
      buffer = Buffer.from(file.base64, 'base64')
    } catch {
      res.status(400).json({ ok: false, error: `Could not decode "${file.name}"` })
      return
    }
    if (buffer.length > MAX_FILE_BYTES) {
      res.status(400).json({
        ok: false,
        error: `"${file.name}" is too large (max ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB).`,
      })
      return
    }

    const mediaType = imageMediaType(file.name)
    if (mediaType) {
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: file.base64 } })
      continue
    }

    try {
      const { text } = await extractTextFromFile(file.name, buffer)
      if (text.trim()) {
        extractedTexts.push(`--- ${file.name} ---\n${text.trim()}`)
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : `Could not read "${file.name}"` })
      return
    }
  }

  if (extractedTexts.length === 0 && imageBlocks.length === 0 && !trimmedDescription) {
    res.status(400).json({
      ok: false,
      error: `No readable content was found. Supported file types: ${SUPPORTED_EXTENSIONS.join(', ')}, or a photo (${Object.keys(IMAGE_MEDIA_TYPES).join(', ')}).`,
    })
    return
  }

  const textParts: string[] = []
  if (trimmedDescription) textParts.push(`--- Typed description ---\n${trimmedDescription}`)
  textParts.push(...extractedTexts)

  let combined = textParts.join('\n\n')
  let truncated = false
  if (combined.length > MAX_COMBINED_CHARS) {
    combined = combined.slice(0, MAX_COMBINED_CHARS)
    truncated = true
  }

  const userContent: ClaudeContentBlock[] = []
  if (combined) userContent.push({ type: 'text', text: combined })
  userContent.push(...imageBlocks)

  let fields: Record<IntakeFieldKey, string>
  try {
    const rawText = await callClaude({
      apiKey: anthropicKey,
      model: EXTRACTION_MODEL,
      maxTokens: 4000,
      system: buildSystemPrompt(),
      user: userContent,
      label: 'extract',
    })

    const parsed = JSON.parse(stripCodeFence(rawText)) as Record<string, unknown>
    const result = {} as Record<IntakeFieldKey, string>
    for (const key of INTAKE_FIELD_KEYS) {
      const value = parsed[key]
      result[key] = typeof value === 'string' ? value.trim() : ''
    }
    fields = result
  } catch (err) {
    console.error('[extract] failed:', err)
    res.status(502).json({ ok: false, error: 'Could not get a valid response from Claude' })
    return
  }

  const foundRequiredFields = REQUIRED_COMMITMENT_KEYS.filter((k) => fields[k])
  const missingRequiredFields = REQUIRED_COMMITMENT_KEYS.filter((k) => !fields[k])

  res.status(200).json({
    ok: true,
    fields,
    foundRequiredFields,
    missingRequiredFields,
    filesProcessed: (files ?? []).map((f) => f.name),
    truncated,
  })
}
