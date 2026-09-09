// The block every generated proposal opens with — title, then a To/From/Date/
// commitment summary, mirroring how a formal document (grant proposal, RFP
// response, etc.) typically opens. Deterministic and code-assembled from
// fields already on the proposal row — no AI call, nothing to verify,
// because there's nothing here that wasn't already trusted verbatim input.
interface DocumentHeaderProps {
  companyName: string | null
  clientName: string | null
  salespersonName: string | null
  sentAt: string | null
  estimatedPricing: string | null
  proposedTimeline: string | null
}

// The date of call is client-supplied and can be genuinely absent — but the
// document's own "Date" line doesn't need to depend on that. A proposal that
// has been sent has a send date by definition, so deriving from sent_at
// instead makes "blank" structurally impossible: it's either a real date, or
// "Draft" before sending. No fallback marker needed because there's no gap
// left to fall back from.
function formatDocDate(sentAt: string | null): string {
  if (!sentAt) return 'Draft'
  return new Date(sentAt).toLocaleDateString()
}

// The header is a quick-glance summary, not the place for the full breakdown
// — the complete verbatim text still lives in the Pricing/Timeline sections
// below. This is a purely mechanical truncation (split on an early colon or
// period), never a reworded paraphrase — it can't drift from what was
// actually supplied, and the full text is always one tooltip/scroll away.
function headerSummary(text: string): { short: string; truncated: boolean } {
  const trimmed = text.trim()
  if (trimmed.length <= 40) return { short: trimmed, truncated: false }

  const colonIdx = trimmed.indexOf(':')
  if (colonIdx > 0 && colonIdx <= 40) {
    return { short: trimmed.slice(0, colonIdx).trim(), truncated: true }
  }

  const periodIdx = trimmed.indexOf('. ')
  if (periodIdx > 0 && periodIdx <= 40) {
    return { short: trimmed.slice(0, periodIdx + 1).trim(), truncated: true }
  }

  return { short: trimmed, truncated: false }
}

function CommitmentValue({ value }: { value: string }) {
  const { short, truncated } = headerSummary(value)
  return <span title={truncated ? value : undefined}>{short}</span>
}

export function DocumentHeader({
  companyName,
  clientName,
  salespersonName,
  sentAt,
  estimatedPricing,
  proposedTimeline,
}: DocumentHeaderProps) {
  return (
    <div className="doc-header">
      <h2 className="doc-header-title">Proposal: {companyName?.trim() || 'Untitled'}</h2>
      <dl className="doc-header-meta">
        <div>
          <dt>To</dt>
          <dd>{clientName?.trim() || '—'}</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>{salespersonName?.trim() ? `${salespersonName}, Koya` : 'Koya'}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDocDate(sentAt)}</dd>
        </div>
        <div>
          <dt>Estimated Pricing</dt>
          <dd>
            {estimatedPricing?.trim() ? (
              <CommitmentValue value={estimatedPricing} />
            ) : (
              <span className="missing-marker">[ Pricing not provided — to be confirmed ]</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Proposed Timeline</dt>
          <dd>
            {proposedTimeline?.trim() ? (
              <CommitmentValue value={proposedTimeline} />
            ) : (
              <span className="missing-marker">[ Timeline not provided — to be confirmed ]</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
