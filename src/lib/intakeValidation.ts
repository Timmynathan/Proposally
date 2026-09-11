import type { ProposalIntake } from './types'

// All 8 fields required before a proposal can be generated — the four
// commitments plus the four contact/admin fields needed for the document to
// even make sense (there's no "marker" story for a proposal addressed to no
// one). Shared by IntakeForm.tsx (creating a new proposal) and
// ProposalView.tsx (generating/regenerating an existing one) so the two
// entry points into generation can never drift out of sync with each other.
export const REQUIRED_INTAKE_FIELDS: (keyof ProposalIntake)[] = [
  'client_name',
  'client_email',
  'company_name',
  'client_needs_summary',
  'project_scope',
  'recommended_services',
  'proposed_timeline',
  'estimated_pricing',
]

export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  client_name: 'Client name',
  client_email: 'Client email',
  company_name: 'Company name',
  client_needs_summary: "Summary of client's needs",
  project_scope: 'Project scope',
  recommended_services: 'Deliverables / services',
  proposed_timeline: 'Timeline',
  estimated_pricing: 'Budget',
}

// Deliberately simple — good enough to catch a typo or a blank field
// pretending to be an email, not a full RFC 5322 validator.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Blocks generation outright — every field here must be filled, and the
// email must look like an email, before generation (or regeneration) runs.
export function validateIntake(intake: Pick<ProposalIntake, (typeof REQUIRED_INTAKE_FIELDS)[number]>): string | null {
  const missingLabels = REQUIRED_INTAKE_FIELDS.filter((key) => !intake[key]?.trim()).map((key) => REQUIRED_FIELD_LABELS[key])
  if (missingLabels.length > 0) {
    return `Please fill in the following before generating: ${missingLabels.join(', ')}.`
  }
  if (!EMAIL_PATTERN.test(intake.client_email.trim())) {
    return "Client email doesn't look like a valid email address."
  }
  return null
}
