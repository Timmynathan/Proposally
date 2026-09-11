import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  restFetch,
  logEvent,
  fetchProposal,
  requiredEnv,
  sendResendEmail,
  describeNotificationError,
  escapeHtml,
  type RestContext,
} from './_lib/proposals.js'

export const config = {
  maxDuration: 30,
}

// Plain, simple HTML per the design brief: one line of text and a link, no
// layout tables, no images, no branding chrome. `text` is a fallback for
// clients that don't render HTML — same content, not a second message.
function buildReviewerEmail(params: {
  salesperson: string
  companyName: string
  reviewLink: string
}): { subject: string; html: string; text: string } {
  const { salesperson, companyName, reviewLink } = params
  const line = `${salesperson} has sent a proposal for ${companyName} for your approval.`
  return {
    subject: `Proposal for ${companyName} — ready for your review`,
    html: `<p>${escapeHtml(line)}</p><p><a href="${reviewLink}">${reviewLink}</a></p>`,
    text: `${line}\n\n${reviewLink}`,
  }
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
  // RESEND_API_KEY / BASE_URL are read again, lazily, right before the
  // notification attempt below — deliberately NOT required here. Submitting
  // for review must succeed even if the notification side is misconfigured;
  // see the rule this whole endpoint is built around, below.

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

  if (proposal.status !== 'draft' && proposal.status !== 'rejected') {
    res.status(409).json({ ok: false, error: `Cannot submit a proposal with status "${proposal.status}" for review.` })
    return
  }

  // --- The commit. This is the state change that matters; everything below
  // this point is best-effort and must never be allowed to undo it or turn
  // its success into an error response. ---
  const updateRes = await restFetch(ctx, `/proposals?id=eq.${proposalId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'in_review' }),
  })
  if (!updateRes.ok) {
    const errBody = await updateRes.json().catch(() => ({ message: updateRes.statusText }))
    res.status(500).json({ ok: false, error: (errBody as { message?: string }).message ?? 'Could not submit for review' })
    return
  }

  await logEvent(ctx, proposalId, 'submitted', true, {})

  // --- Best-effort reviewer notification. Any failure here — missing config,
  // no reviewer found, Resend unreachable — is caught, logged, and otherwise
  // invisible to the caller: the submit already succeeded above. ---
  try {
    const resendKey = process.env.RESEND_API_KEY
    const publicBaseUrl = process.env.BASE_URL
    if (!resendKey || !publicBaseUrl) {
      throw new Error('RESEND_API_KEY or BASE_URL is not configured')
    }

    const reviewersRes = await restFetch(ctx, '/rpc/get_reviewer_emails', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!reviewersRes.ok) {
      const errBody = await reviewersRes.json().catch(() => ({}))
      throw new Error(`Could not look up reviewers: ${(errBody as { message?: string }).message ?? reviewersRes.status}`)
    }
    const reviewers = (await reviewersRes.json()) as { user_id: string; email: string | null }[]
    const recipients = reviewers.map((r) => r.email).filter((e): e is string => Boolean(e))
    if (recipients.length === 0) {
      throw new Error('No reviewer with a staff row and an email address was found')
    }

    // Authenticated app route, not the client-facing share link — this is an
    // internal notification, and it never carries the share_token.
    const reviewLink = `${publicBaseUrl.replace(/\/$/, '')}/review/${proposalId}`
    const email = buildReviewerEmail({
      salesperson: proposal.salesperson_name || 'A salesperson',
      companyName: proposal.company_name || 'a client',
      reviewLink,
    })

    const sendResult = await sendResendEmail({
      resendKey,
      to: recipients,
      subject: email.subject,
      html: email.html,
      text: email.text,
    })
    if (!sendResult.ok) {
      throw Object.assign(new Error('Resend rejected the notification'), { detail: sendResult.body, status: sendResult.status })
    }

    await logEvent(ctx, proposalId, 'notified_reviewer', true, { resendId: sendResult.id, to: recipients })
  } catch (err) {
    console.error('[submit] reviewer notification failed:', err)
    await logEvent(ctx, proposalId, 'notification_failed', false, {
      stage: 'notify_reviewer',
      ...describeNotificationError(err),
    })
  }

  res.status(200).json({ ok: true })
}
