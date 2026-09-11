import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  restFetch,
  logEvent,
  fetchProposal,
  fetchCallerUser,
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
function buildOwnerEmail(params: {
  decision: 'approved' | 'rejected'
  companyName: string
  comment: string | null
  proposalLink: string
}): { subject: string; html: string; text: string } {
  const { decision, companyName, comment, proposalLink } = params
  if (decision === 'approved') {
    const line = `Your proposal for ${companyName} has been approved and is ready to send.`
    return {
      subject: `Proposal for ${companyName} — approved`,
      html: `<p>${escapeHtml(line)}</p><p><a href="${proposalLink}">${proposalLink}</a></p>`,
      text: `${line}\n\n${proposalLink}`,
    }
  }
  // Rejection is the one case where email content includes more than a
  // pointer — the reviewer's comment IS the message here, not a courtesy.
  const line = `Changes have been requested on your proposal for ${companyName}.`
  const commentLine = `Reviewer comment: "${comment}"`
  return {
    subject: `Proposal for ${companyName} — changes requested`,
    html: `<p>${escapeHtml(line)}</p><p>${escapeHtml(commentLine)}</p><p><a href="${proposalLink}">${proposalLink}</a></p>`,
    text: `${line}\n\n${commentLine}\n\n${proposalLink}`,
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

  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.status(401).json({ ok: false, error: 'Missing Authorization header' })
    return
  }

  const { proposalId, decision, comment } = (req.body ?? {}) as {
    proposalId?: string
    decision?: 'approved' | 'rejected'
    comment?: string | null
  }
  if (!proposalId) {
    res.status(400).json({ ok: false, error: 'proposalId is required' })
    return
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    res.status(400).json({ ok: false, error: 'decision must be "approved" or "rejected"' })
    return
  }
  const trimmedComment = comment?.trim() || null
  if (decision === 'rejected' && !trimmedComment) {
    res.status(400).json({ ok: false, error: 'A comment is required when rejecting, so the salesperson knows what to fix.' })
    return
  }

  const ctx: RestContext = { url: env.supabaseUrl, anonKey: env.supabaseAnonKey, authHeader }

  const caller = await fetchCallerUser(ctx)
  if (!caller.ok) {
    res.status(caller.status).json({ ok: false, error: caller.message })
    return
  }

  // Server-side gate: a salesperson must not be able to approve their own
  // proposal by calling this endpoint directly, regardless of what the UI
  // shows or hides. The "reviewers write approvals" RLS policy (Phase 2
  // migration) enforces the same rule again at the database layer on the
  // insert below — this check exists to fail with a clear message instead
  // of a raw Postgres/PostgREST error, the same relationship send.ts has
  // with the enforce_approval_before_send trigger.
  const roleRes = await restFetch(ctx, `/staff?user_id=eq.${caller.id}&select=role`, {
    headers: { Accept: 'application/vnd.pgrst.object+json' },
  })
  const roleBody = roleRes.ok ? ((await roleRes.json()) as { role?: string }) : null
  if (!roleRes.ok || roleBody?.role !== 'reviewer') {
    res.status(403).json({ ok: false, error: 'Only reviewers can approve or reject proposals.' })
    return
  }

  const propResult = await fetchProposal(ctx, proposalId)
  if (!propResult.ok) {
    res.status(propResult.status).json({ ok: false, error: propResult.message })
    return
  }
  const proposal = propResult.proposal

  if (proposal.status !== 'in_review') {
    res.status(409).json({ ok: false, error: `Cannot decide on a proposal with status "${proposal.status}" — it must be in review.` })
    return
  }

  // --- The commit: record the decision, then move status. Both must succeed
  // before anything below is attempted, and neither is undone by whatever
  // happens to the notification after this point. ---
  const approvalRes = await restFetch(ctx, '/proposal_approvals', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ proposal_id: proposalId, decision, comment: trimmedComment, decided_by: caller.id }),
  })
  if (!approvalRes.ok) {
    const errBody = await approvalRes.json().catch(() => ({ message: approvalRes.statusText }))
    res.status(approvalRes.status === 403 ? 403 : 500).json({
      ok: false,
      error: (errBody as { message?: string }).message ?? 'Could not record the decision',
    })
    return
  }

  const updateRes = await restFetch(ctx, `/proposals?id=eq.${proposalId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: decision }),
  })
  if (!updateRes.ok) {
    const errBody = await updateRes.json().catch(() => ({ message: updateRes.statusText }))
    console.error('[decide] approval recorded but status update failed:', errBody)
    res.status(500).json({
      ok: false,
      error: 'The decision was recorded, but updating the proposal status failed. Please retry.',
    })
    return
  }

  await logEvent(ctx, proposalId, decision, true, { comment: trimmedComment, decidedBy: caller.id })

  // --- Best-effort owner notification. The decision above is already final
  // and already returned as committed to the reviewer regardless of what
  // happens next. ---
  try {
    const resendKey = process.env.RESEND_API_KEY
    const publicBaseUrl = process.env.BASE_URL
    if (!resendKey || !publicBaseUrl) {
      throw new Error('RESEND_API_KEY or BASE_URL is not configured')
    }
    const ownerId = proposal.created_by
    if (!ownerId) {
      throw new Error('Proposal has no created_by — nothing to notify')
    }

    const emailRes = await restFetch(ctx, '/rpc/get_staff_email', {
      method: 'POST',
      body: JSON.stringify({ target_user_id: ownerId }),
    })
    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => ({}))
      throw new Error(`Could not look up the proposal owner's email: ${(errBody as { message?: string }).message ?? emailRes.status}`)
    }
    const ownerEmail = (await emailRes.json()) as string | null
    if (!ownerEmail) {
      throw new Error('Proposal owner has no email on file')
    }

    // Authenticated app route, not the client-facing share link.
    const proposalLink = `${publicBaseUrl.replace(/\/$/, '')}/proposal/${proposalId}`
    const email = buildOwnerEmail({
      decision,
      companyName: proposal.company_name || 'your client',
      comment: trimmedComment,
      proposalLink,
    })

    const sendResult = await sendResendEmail({
      resendKey,
      to: ownerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    })
    if (!sendResult.ok) {
      throw Object.assign(new Error('Resend rejected the notification'), { detail: sendResult.body, status: sendResult.status })
    }

    await logEvent(ctx, proposalId, 'notified_owner', true, { resendId: sendResult.id, to: ownerEmail })
  } catch (err) {
    console.error('[decide] owner notification failed:', err)
    await logEvent(ctx, proposalId, 'notification_failed', false, {
      stage: 'notify_owner',
      ...describeNotificationError(err),
    })
  }

  res.status(200).json({ ok: true })
}
