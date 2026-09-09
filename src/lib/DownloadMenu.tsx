import { useEffect, useRef, useState } from 'react'
import { buildMarkdown, buildDocxBlob, triggerBlobDownload } from './exportDoc'
import type { ProposalRow, ProposalSectionRow } from './types'

// Shared between the staff-facing proposal page and the public client-facing
// link — same three export formats, same menu, so the two can't drift apart.
export function DownloadMenu({
  proposal,
  sections,
  fetchPdfBlob,
  disabled,
  onError,
  onPdfDownloaded,
}: {
  proposal: ProposalRow
  sections: ProposalSectionRow[]
  fetchPdfBlob: () => Promise<Blob>
  disabled?: boolean
  onError?: (message: string) => void
  onPdfDownloaded?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  function filenameBase() {
    return proposal.company_name?.trim().replace(/\s+/g, '-').toLowerCase() || proposal.id
  }

  function downloadMarkdown() {
    const md = buildMarkdown(proposal, sections)
    triggerBlobDownload(new Blob([md], { type: 'text/markdown' }), `proposal-${filenameBase()}.md`)
  }

  async function downloadDocx() {
    setBusy('docx')
    try {
      const blob = await buildDocxBlob(proposal, sections)
      triggerBlobDownload(blob, `proposal-${filenameBase()}.docx`)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'DOCX generation failed')
    } finally {
      setBusy(null)
    }
  }

  async function downloadPdf() {
    setBusy('pdf')
    try {
      const blob = await fetchPdfBlob()
      triggerBlobDownload(blob, `proposal-${filenameBase()}.pdf`)
      onPdfDownloaded?.()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'PDF request failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy !== null}
        title="Download"
      >
        <DownloadIcon />
      </button>
      {open && (
        <div className="menu-dropdown">
          <button
            className="menu-item"
            onClick={() => {
              downloadMarkdown()
              setOpen(false)
            }}
          >
            <FormatBadge label="MD" color="#4b5563" />
            Markdown
          </button>
          <button
            className="menu-item"
            disabled={busy === 'docx'}
            onClick={() => {
              void downloadDocx()
              setOpen(false)
            }}
          >
            <FormatBadge label="DOCX" color="#2b579a" />
            {busy === 'docx' ? 'Preparing…' : 'Word (.docx)'}
          </button>
          <button
            className="menu-item"
            disabled={busy === 'pdf'}
            onClick={() => {
              void downloadPdf()
              setOpen(false)
            }}
          >
            <FormatBadge label="PDF" color="#b3261e" />
            {busy === 'pdf' ? 'Preparing…' : 'PDF'}
          </button>
        </div>
      )}
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  )
}

function FormatBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="format-badge" style={{ background: color }}>
      {label}
    </span>
  )
}
