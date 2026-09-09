import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SectionContent } from '../lib/SectionContent'
import { DocumentHeader } from '../lib/DocumentHeader'
import { DownloadMenu } from '../lib/DownloadMenu'
import { SECTION_KEYS, type ProposalRow, type ProposalSectionRow } from '../lib/types'

const SECTION_TITLES: Record<string, string> = {
  introduction: 'Introduction',
  proposed_solution: 'Proposed Solution',
  deliverables: 'Deliverables',
  timeline: 'Timeline',
  pricing: 'Pricing',
  next_steps: 'Next Steps',
}

// No auth here — this is the client-facing page, reached via a long random
// token. get_proposal_by_token() is a security-definer function granted to the
// anon role (schema.sql) that only ever returns a row when the token matches
// AND status = 'sent'; a draft is unreachable even with its token.
export function PublicProposal() {
  const { token } = useParams<{ token: string }>()
  const [proposal, setProposal] = useState<ProposalRow | null>(null)
  const [sections, setSections] = useState<ProposalSectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    // get_proposal_by_token returns `json` (a scalar), not a row set, so `data`
    // here is already the object itself — no .single() needed (that header is
    // for table selects expected to return exactly one row).
    supabase
      .rpc('get_proposal_by_token', { t: token })
      .then(({ data, error }) => {
        setLoading(false)
        const result = data as { proposal: ProposalRow; sections: ProposalSectionRow[] } | null
        if (error || !result || !result.proposal) {
          setNotFound(true)
          return
        }
        setProposal(result.proposal)
        setSections((result.sections ?? []).sort((a, b) => a.position - b.position))
      })
  }, [token])

  async function fetchPdfBlob(): Promise<Blob> {
    const res = await fetch(`/api/pdf?token=${token}`)
    if (!res.ok) throw new Error('PDF request failed')
    return res.blob()
  }

  if (loading) {
    return <div className="public-page" />
  }

  if (notFound || !proposal) {
    return (
      <div className="public-page">
        <div style={{ textAlign: 'center', paddingTop: '10vh' }}>
          <h1>This proposal isn't available</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            The link may be incorrect, or the proposal hasn't been sent yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="public-page">
      <div className="public-doc">
        <div className="doc-window-header">
          <div className="doc-window-header-main">
            <DocIcon />
            <span className="doc-window-title">Proposal: {proposal.company_name || 'Untitled'}</span>
          </div>
          <div className="doc-window-header-actions">
            <DownloadMenu proposal={proposal} sections={sections} fetchPdfBlob={fetchPdfBlob} onError={setDownloadError} />
          </div>
        </div>

        <div className="public-doc-body">
          {downloadError && <div className="banner danger" style={{ marginBottom: 20 }}>{downloadError}</div>}

          <DocumentHeader
            companyName={proposal.company_name}
            clientName={proposal.client_name}
            salespersonName={proposal.salesperson_name}
            sentAt={proposal.sent_at}
            estimatedPricing={proposal.estimated_pricing}
            proposedTimeline={proposal.proposed_timeline}
          />

          {SECTION_KEYS.map((key) => {
            const section = sections.find((s) => s.key === key)
            return (
              <div className="section-block card" key={key}>
                <h3>{SECTION_TITLES[key]}</h3>
                <SectionContent content={section?.content} />
              </div>
            )
          })}

          <p className="public-doc-signoff">
            Warm regards,
            <br />
            {proposal.salesperson_name}
            <br />
            Koya
          </p>
        </div>
      </div>
    </div>
  )
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  )
}
