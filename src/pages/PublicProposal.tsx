import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SectionContent } from '../lib/SectionContent'
import { DocumentHeader } from '../lib/DocumentHeader'
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
  const [downloading, setDownloading] = useState(false)

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

  async function handleDownload() {
    if (!token) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/pdf?token=${token}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `proposal-${proposal?.company_name?.replace(/\s+/g, '-').toLowerCase() || 'koya'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <div className="app-shell" style={{ maxWidth: 720 }} />
  }

  if (notFound || !proposal) {
    return (
      <div className="app-shell" style={{ maxWidth: 720, paddingTop: '10vh', textAlign: 'center' }}>
        <h1>This proposal isn't available</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          The link may be incorrect, or the proposal hasn't been sent yet.
        </p>
      </div>
    )
  }

  return (
    <div className="app-shell" style={{ maxWidth: 720 }}>
      <DocumentHeader
        companyName={proposal.company_name}
        clientName={proposal.client_name}
        salespersonName={proposal.salesperson_name}
        sentAt={proposal.sent_at}
        estimatedPricing={proposal.estimated_pricing}
        proposedTimeline={proposal.proposed_timeline}
      />

      <button onClick={handleDownload} disabled={downloading} style={{ marginBottom: 28 }}>
        {downloading ? 'Preparing PDF…' : 'Download as PDF'}
      </button>

      {SECTION_KEYS.map((key) => {
        const section = sections.find((s) => s.key === key)
        return (
          <div className="section-block" key={key}>
            <h3>{SECTION_TITLES[key]}</h3>
            <SectionContent content={section?.content} />
          </div>
        )
      })}

      <p style={{ marginTop: 40, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        Warm regards,
        <br />
        {proposal.salesperson_name}
        <br />
        Proposally
      </p>
    </div>
  )
}
