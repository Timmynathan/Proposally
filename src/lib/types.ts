export type ProposalStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'sent'

export type StaffRole = 'sales' | 'reviewer'

// The four fields that carry obligation. If any is empty, the proposal cannot be sent.
export const REQUIRED_COMMITMENT_FIELDS = [
  'project_scope',
  'recommended_services',
  'proposed_timeline',
  'estimated_pricing',
] as const

export type RequiredCommitmentField = (typeof REQUIRED_COMMITMENT_FIELDS)[number]

export interface ProposalIntake {
  client_name: string
  client_email: string
  company_name: string
  date_of_call: string // yyyy-mm-dd
  salesperson_name: string
  client_needs_summary: string
  project_scope: string
  goals_and_objectives: string
  recommended_services: string
  proposed_timeline: string
  estimated_pricing: string
  supporting_material: string
}

export interface ProposalRow extends ProposalIntake {
  id: string
  share_token: string
  status: ProposalStatus
  missing_fields: RequiredCommitmentField[]
  created_by: string | null
  created_at: string
  updated_at: string
  sent_at: string | null
}

export const SECTION_KEYS = [
  'introduction',
  'proposed_solution',
  'deliverables',
  'timeline',
  'pricing',
  'next_steps',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export interface ProposalSectionRow {
  id: string
  proposal_id: string
  key: SectionKey
  position: number
  content: string | null
  generated_at: string | null
  edited_by_human: boolean
}

export interface VerificationWarning {
  field: RequiredCommitmentField
  section: SectionKey
  detail: string
}

export interface GenerateResponse {
  ok: boolean
  sections?: ProposalSectionRow[]
  warnings?: VerificationWarning[]
  error?: string
}

export interface ProposalEventRow {
  id: number
  proposal_id: string
  event: string
  ok: boolean
  detail: unknown
  at: string
}

export interface ProposalApprovalRow {
  id: string
  proposal_id: string
  decision: 'approved' | 'rejected'
  comment: string | null
  decided_by: string
  decided_at: string
}
