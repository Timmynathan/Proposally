import type { VercelRequest, VercelResponse } from '@vercel/node'
import { restFetch, logEvent, fetchProposal, requiredEnv, type RestContext } from './_lib/proposals.js'

export const config = {
  maxDuration: 30,
}

// Resend's sandbox sender works without a verified domain, but in that mode
// Resend only delivers to the account owner's own verified address — sending to
// an arbitrary client_email will need a verified sending domain in Resend.
// Overridable so a verified domain can be swapped in without a code change.
const DEFAULT_FROM = 'Proposally <onboarding@resend.dev>'

function buildEmail(params: { clientName: string; companyName: string; salesperson: string; proposalLink: string }): {
  subject: string
  text: string
} {
  const { clientName, companyName, salesperson, proposalLink } = params
  return {
    subject: `Proposal for ${companyName}`,
    text: `Hi ${clientName},

Thanks again for taking the time to speak with us. Based on our conversation, we have put together a customized proposal for your review.

You can view the proposal here: ${proposalLink}

This document outlines the project scope, timeline, pricing details, and recommended approach.

If you have any questions or would like to make adjustments, feel free to reach out. We are happy to iterate with you.

Looking forward to hearing your thoughts.

Best regards,

${salesperson}

Proposally`,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const env = requiredEnv()
  const resendKey = process.env.RESEND_API_KEY
  const publicBaseUrl = process.env.PUBLIC_BASE_URL
  if (!env || !resendKey || !publicBaseUrl) {
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

  const ctx: RestContext = { url: env.supabaseUrl, anonKey: env.supabaseAnonKey, authHeader }

  const propResult = await fetchProposal(ctx, proposalId)
  if (!propResult.ok) {
    res.status(propResult.status).json({ ok: false, error: propResult.message })
    return
  }
  const proposal = propResult.proposal

  // Belt-and-suspenders: the database trigger is the real gate (it fires on the
  // status update below and cannot be bypassed), but checking here first means a
  // blocked send fails with a clear message instead of a raw Postgres exception.
  if (proposal.status !== 'approved') {
    res.status(409).json({ ok: false, error: `Cannot send a proposal with status "${proposal.status}" — it must be approved first.` })
    return
  }
  if (proposal.missing_fields.length > 0) {
    res.status(409).json({ ok: false, error: `Cannot send — missing required fields: ${proposal.missing_fields.join(', ')}` })
    return
  }
  if (!proposal.client_email) {
    res.status(409).json({ ok: false, error: 'Cannot send — no client email on file.' })
    return
  }

  const approvalRes = await restFetch(ctx, `/proposal_approvals?proposal_id=eq.${proposalId}&decision=eq.approved&select=id&limit=1`)
  const approvalRows = approvalRes.ok ? await approvalRes.json() : []
  if (!Array.isArray(approvalRows) || approvalRows.length === 0) {
    res.status(409).json({ ok: false, error: 'Cannot send — no approval record found.' })
    return
  }

  const proposalLink = `${publicBaseUrl.replace(/\/$/, '')}/p/${proposal.share_token}`
  const email = buildEmail({
    clientName: proposal.client_name ?? 'there',
    companyName: proposal.company_name ?? 'your company',
    salesperson: proposal.salesperson_name ?? 'Proposally',
    proposalLink,
  })

  let resendId: string | undefined
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
        to: proposal.client_email,
        subject: email.subject,
        text: email.text,
      }),
    })

    const resendBody = await resendRes.json().catch(() => ({}))
    if (!resendRes.ok) {
      console.error('[send] Resend error:', resendBody)
      await logEvent(ctx, proposalId, 'email_failed', false, { status: resendRes.status, body: resendBody })
      res.status(502).json({ ok: false, error: (resendBody as { message?: string }).message ?? 'Email provider rejected the send' })
      return
    }
    resendId = (resendBody as { id?: string }).id
  } catch (err) {
    console.error('[send] failed calling Resend:', err)
    await logEvent(ctx, proposalId, 'email_failed', false, {
      message: err instanceof Error ? err.message : 'Unknown error calling Resend',
    })
    res.status(502).json({ ok: false, error: 'Could not reach the email provider' })
    return
  }

  // This update is what the enforce_approval_before_send trigger actually
  // guards. Everything above is a friendlier pre-check; this is the real gate,
  // and it cannot be bypassed by calling this endpoint directly or any other way.
  const updateRes = await restFetch(ctx, `/proposals?id=eq.${proposalId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }),
  })

  if (!updateRes.ok) {
    const errBody = await updateRes.json().catch(() => ({ message: updateRes.statusText }))
    const message = (errBody as { message?: string }).message ?? 'Unknown error'
    console.error('[send] email sent but status update was rejected:', message)
    await logEvent(ctx, proposalId, 'email_sent', false, {
      message: `Email was sent (Resend id ${resendId}) but marking the proposal as sent failed: ${message}`,
    })
    res.status(500).json({ ok: false, error: `Email sent, but failed to update status: ${message}` })
    return
  }

  await logEvent(ctx, proposalId, 'email_sent', true, { resendId, to: proposal.client_email })

  res.status(200).json({ ok: true })
}
