import { Document, Packer, Paragraph, HeadingLevel } from 'docx'
import { SECTION_KEYS, type ProposalRow, type ProposalSectionRow } from './types'

function metaLines(proposal: ProposalRow): [string, string][] {
  return [
    ['To', proposal.client_name?.trim() || '—'],
    ['From', `${proposal.salesperson_name?.trim() || 'Proposally'}, Proposally`],
    ['Date', proposal.date_of_call?.trim() || '—'],
    ['Estimated Pricing', proposal.estimated_pricing?.trim() || 'Not provided — to be confirmed'],
    ['Proposed Timeline', proposal.proposed_timeline?.trim() || 'Not provided — to be confirmed'],
  ]
}

export function buildMarkdown(proposal: ProposalRow, sections: ProposalSectionRow[]): string {
  const lines: string[] = [`# Proposal: ${proposal.company_name?.trim() || 'Untitled'}`, '']
  for (const [label, value] of metaLines(proposal)) {
    lines.push(`**${label}:** ${value}  `)
  }
  lines.push('', '---')
  for (const key of SECTION_KEYS) {
    const section = sections.find((s) => s.key === key)
    lines.push('', `## ${key.replace('_', ' ')}`, '', section?.content?.trim() || '_Not generated_')
  }
  return lines.join('\n')
}

export async function buildDocxBlob(proposal: ProposalRow, sections: ProposalSectionRow[]): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({ text: `Proposal: ${proposal.company_name?.trim() || 'Untitled'}`, heading: HeadingLevel.TITLE }),
  ]

  for (const [label, value] of metaLines(proposal)) {
    children.push(new Paragraph({ text: `${label}: ${value}` }))
  }

  for (const key of SECTION_KEYS) {
    const section = sections.find((s) => s.key === key)
    children.push(new Paragraph({ text: key.replace('_', ' '), heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }))
    const content = section?.content?.trim() || 'Not generated'
    for (const para of content.split('\n').filter((p) => p.trim())) {
      children.push(new Paragraph({ text: para, spacing: { after: 120 } }))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
