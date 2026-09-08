// Renders section content, styling missing-field marker lines (inserted by
// api/_lib/proposals.ts as `[ Label not provided — to be confirmed ]`)
// distinctly from generated prose — visible as a placeholder, not just bracketed
// text sitting in a paragraph.
const MARKER_PATTERN = /^\[ .+ \]$/

export function SectionContent({ content }: { content: string | null | undefined }) {
  if (!content) {
    return <em style={{ color: 'var(--text-muted)' }}>(empty)</em>
  }
  const paragraphs = content.split(/\n\n+/)
  return (
    <div className="section-body">
      {paragraphs.map((part, i) =>
        MARKER_PATTERN.test(part.trim()) ? (
          <span className="missing-marker" key={i}>
            {part.trim()}
          </span>
        ) : (
          <p key={i} style={{ whiteSpace: 'pre-wrap', margin: i === 0 ? '0 0 0.8em' : '0.8em 0' }}>
            {part}
          </p>
        ),
      )}
    </div>
  )
}
