import type { VercelRequest, VercelResponse } from '@vercel/node'
import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import {
  SECTION_KEYS,
  type SectionKey,
  type ProposalRecord,
  restFetch,
  logEvent,
  fetchProposal,
  requiredEnv,
  type RestContext,
} from './_lib/proposals.js'

export const config = {
  maxDuration: 30,
}

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#1a1a1a' },
  docTitle: { fontSize: 18, marginBottom: 14, fontFamily: 'Helvetica-Bold' },
  metaBlock: { marginBottom: 24, borderBottomWidth: 1.5, borderBottomColor: '#000000', paddingBottom: 14 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: '#cccccc', paddingBottom: 4, marginBottom: 4 },
  metaLabel: { fontSize: 9, color: '#666666' },
  metaValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  h2: { fontSize: 13, marginTop: 16, marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  body: { fontSize: 11, lineHeight: 1.5 },
  marker: { fontSize: 11, lineHeight: 1.5, fontStyle: 'italic', color: '#8a5a00' },
  signoff: { marginTop: 28, fontSize: 11, lineHeight: 1.6 },
})

const SECTION_TITLES: Record<SectionKey, string> = {
  introduction: 'Introduction',
  proposed_solution: 'Proposed Solution',
  deliverables: 'Deliverables',
  timeline: 'Timeline',
  pricing: 'Pricing',
  next_steps: 'Next Steps',
}

const MARKER_PATTERN = /^\[ .+ \]$/

interface SectionForPdf {
  key: string
  content: string | null
  position: number
}

// Mirrors headerSummary() in src/lib/DocumentHeader.tsx — the header is a
// quick-glance summary, not the full breakdown (that stays in the Pricing/
// Timeline sections below). Purely mechanical truncation, not a paraphrase.
function headerSummary(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 40) return trimmed
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx > 0 && colonIdx <= 40) return trimmed.slice(0, colonIdx).trim()
  const periodIdx = trimmed.indexOf('. ')
  if (periodIdx > 0 && periodIdx <= 40) return trimmed.slice(0, periodIdx + 1).trim()
  return trimmed
}

// Same front matter as DocumentHeader.tsx (the on-screen equivalent) — title
// then a To/From/Date/commitment summary. Code-assembled from fields already
// on the row, not AI-generated, so there's nothing here to verify.
function metaRow(label: string, value: string) {
  return React.createElement(
    View,
    { style: styles.metaRow },
    React.createElement(Text, { style: styles.metaLabel }, label),
    React.createElement(Text, { style: styles.metaValue }, value),
  )
}

function buildPdfDocument(proposal: ProposalRecord, sections: SectionForPdf[]) {
  const ordered = SECTION_KEYS.map((k) => sections.find((s) => s.key === k)).filter(
    (s): s is SectionForPdf => Boolean(s),
  )

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(Text, { style: styles.docTitle }, `Proposal: ${proposal.company_name?.trim() || 'Untitled'}`),
      React.createElement(
        View,
        { style: styles.metaBlock },
        metaRow('To', proposal.client_name?.trim() || '—'),
        metaRow('From', proposal.salesperson_name?.trim() ? `${proposal.salesperson_name}, Proposally` : 'Proposally'),
        metaRow('Date', proposal.sent_at ? new Date(proposal.sent_at).toLocaleDateString() : 'Draft'),
        metaRow('Estimated Pricing', proposal.estimated_pricing?.trim() ? headerSummary(proposal.estimated_pricing) : '[ Pricing not provided — to be confirmed ]'),
        metaRow('Proposed Timeline', proposal.proposed_timeline?.trim() ? headerSummary(proposal.proposed_timeline) : '[ Timeline not provided — to be confirmed ]'),
      ),
      ...ordered.map((s) =>
        React.createElement(
          View,
          { key: s.key },
          React.createElement(Text, { style: styles.h2 }, SECTION_TITLES[s.key as SectionKey]),
          ...(s.content ?? '').split(/\n\n+/).map((para, i) =>
            React.createElement(
              Text,
              { key: i, style: MARKER_PATTERN.test(para.trim()) ? styles.marker : styles.body },
              para,
            ),
          ),
        ),
      ),
      React.createElement(
        Text,
        { style: styles.signoff },
        `Warm regards,\n${proposal.salesperson_name ?? ''}\nProposally`,
      ),
    ),
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = requiredEnv()
  if (!env) {
    res.status(500).json({ ok: false, error: 'Server is missing required environment variables' })
    return
  }

  const idParam = req.query.id
  const tokenParam = req.query.token
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam

  let proposal: ProposalRecord
  let sections: SectionForPdf[]
  let ctx: RestContext | null = null

  if (token) {
    // Public path: no session at all. Goes through the same security-definer
    // function the public page uses, which only ever returns a row when the
    // token matches AND status = 'sent' — a draft is unreachable even with its
    // token. Deliberately does not write a proposal_events row here: doing so
    // would need an RLS policy letting the anon role insert into that table,
    // which is a bigger attack surface than a missing log line on a client's
    // own PDF download of an already-sent proposal.
    const rpcRes = await fetch(`${env.supabaseUrl}/rest/v1/rpc/get_proposal_by_token`, {
      method: 'POST',
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ t: token }),
    })
    if (!rpcRes.ok) {
      res.status(404).json({ ok: false, error: 'Not found' })
      return
    }
    const body = (await rpcRes.json()) as { proposal: ProposalRecord; sections: SectionForPdf[] } | null
    if (!body || !body.proposal) {
      res.status(404).json({ ok: false, error: 'Not found' })
      return
    }
    proposal = body.proposal
    sections = body.sections ?? []
  } else if (id) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      res.status(401).json({ ok: false, error: 'Missing Authorization header' })
      return
    }
    ctx = { url: env.supabaseUrl, anonKey: env.supabaseAnonKey, authHeader }
    const propResult = await fetchProposal(ctx, id)
    if (!propResult.ok) {
      res.status(propResult.status).json({ ok: false, error: propResult.message })
      return
    }
    proposal = propResult.proposal
    const secRes = await restFetch(ctx, `/proposal_sections?proposal_id=eq.${id}&select=key,content,position&order=position`)
    sections = secRes.ok ? ((await secRes.json()) as SectionForPdf[]) : []
  } else {
    res.status(400).json({ ok: false, error: 'id or token query parameter is required' })
    return
  }

  try {
    const buffer = await renderToBuffer(buildPdfDocument(proposal, sections))
    if (ctx) await logEvent(ctx, proposal.id, 'pdf_built', true, {})
    const filename = `proposal-${(proposal.company_name || 'koya').replace(/\s+/g, '-').toLowerCase()}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.status(200).send(buffer)
  } catch (err) {
    console.error('[pdf] failed:', err)
    if (ctx) {
      await logEvent(ctx, proposal.id, 'pdf_built', false, {
        message: err instanceof Error ? err.message : 'Unknown PDF error',
      })
    }
    res.status(500).json({ ok: false, error: 'Failed to build PDF' })
  }
}
