# Week 3 Handoff — AI Proposal Application

Everything needed to continue this build in Claude Code. Written for a fresh session with no
memory of the conversation that produced it.

**Owner:** Modupe Ilesanmi · StackShift "Building Production-Ready Systems", Cohort 3
**Client (fictional):** Koya Talent

---

## 1. The brief, as given

> After discovery calls, the sales team writes custom client proposals by pulling from notes, old
> proposals, saved templates, and internal context. The process takes too long, and the quality
> depends heavily on who writes the proposal. The team needs a better way to turn sales
> requirements into a polished proposal while keeping a human in control before anything goes to
> the client.

Build an AI-powered proposal application that takes client and project inputs, uses Claude to
generate proposal content, lets a salesperson review and revise the output, creates a final
proposal document, handles internal approval before client delivery, and logs the proposal in a
central place. A **small web application** using the **Claude API**. Frontend, backend, database,
approval flow, document generation and delivery tools are all free choices.

**Deliverables:** application link · a generated proposal sample · completed testing evidence
table · Loom walkthrough · reflection sheet · one-page documentation.

---

## 2. What this project actually is

The brief's stated problem is speed and inconsistency. That's the symptom. The thing to design
around is that **a proposal is a commercial commitment with the company's name on it** — scope, a
timeline, and a price.

Week 2's worst failure was a wrong number on an internal dashboard: embarrassing, fixable. This
project's worst failure is a document sent to a customer promising work the company can't deliver
at a price that loses money. It can't be unsent, and "the AI wrote it" is not a defence.

Two rules follow, and everything else is detail.

### Rule 1 — Claude writes prose. Claude never writes commitments.

Price, timeline, scope and deliverables come from the intake form **verbatim**. They are inputs to
the document, not generated content. Claude writes the introduction, the framing, and the
recommended approach — the language a good salesperson puts around those facts. It does not decide
six weeks sounds reasonable, round a price, or add a deliverable that "usually goes with this kind
of work".

This is the direct descendant of the Week 2 rule that every number was computed in code and the
model only narrated. Same principle, higher stakes.

### Rule 2 — A gap stays a gap.

If the intake form has no timeline, a helpful model writes "approximately 4–6 weeks", because
that is what proposals say. It reads perfectly. It is fabricated. Someone skims, approves, and the
company is committed.

So a missing required field produces a **visible marker in the document and a hard block on
approval** — never a plausible sentence. Absence must look like absence. Constraining what the
model can put in the box is more reliable than instructing it not to; this was proven the hard way
in Week 2, where three rounds of prompt instructions failed to stop the model dramatising and
removing the misleading input fixed it immediately.

---

## 3. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Architecture | Everything in the web app — React + TypeScript + Vite, Vercel serverless functions, Supabase. No n8n. | Same stack as Week 2, known to work, one repo, fewer moving parts. |
| Document output | Hosted page on a token **and** PDF export | The supplied email template references `{{proposal_link}}`; the PDF is for the client's records. |
| Approval | A second user with a reviewer role approves or rejects in the app, with a comment | Cleanly demonstrable, and the gate can be enforced in the database rather than the UI. |
| Delivery | Real email send via Resend (free tier) | Exercises the full path and makes the failure case testable. |
| Auth | Supabase Auth, email/password, public sign-ups disabled, users provisioned by hand | Carried over from Week 2, where this pattern is already proven. |

---

## 4. Reference material supplied with the brief

### 4.1 Intake fields

| Field | Key | Notes |
|---|---|---|
| Client Name | `client_name` | Name of the client contact |
| Client Email | `client_email` | Email address for client delivery |
| Company Name | `company_name` | Client company or organization |
| Date of Call | `date_of_call` | Date the discovery call happened |
| Salesperson Name | `salesperson_name` | Person preparing or owning the proposal |
| Summary of Client's Needs | `client_needs_summary` | The problem the client wants solved |
| Project Scope | `project_scope` | What the client wants built or delivered |
| Goals and Objectives | `goals_and_objectives` | Outcomes wanted — revenue, efficiency, less manual work |
| Recommended Services or Deliverables | `recommended_services` | Proposed services, outputs, deliverables |
| Proposed Timeline | `proposed_timeline` | Duration, phases, or delivery window |
| Estimated Pricing | `estimated_pricing` | Price, range, or pricing notes |

Fields may be renamed or added. **Add `supporting_material`** (free text, optional) to satisfy
test scenario 3.

**Required commitments** — the four fields that carry obligation, and the ones that block
approval when missing: `project_scope`, `recommended_services`, `proposed_timeline`,
`estimated_pricing`.

### 4.2 Proposal template

Six sections. Placeholders in `{{ }}`.

1. **Introduction** — thanks for the call; addresses `{{client_needs_summary}}` for
   `{{company_name}}`; excited to support; believes the solution will help
   `{{goals_and_objectives}}`
2. **Proposed Solution** — sub-sections **Project Scope** (`{{project_scope}}`) and
   **Recommended Approach** (`{{recommended_approach}}` — *generated*); closes with a line about
   being practical for current systems, team capacity and goals
3. **Deliverables** — `{{deliverables}}`
4. **Timeline** — `{{proposed_timeline}}`; includes implementation, testing, feedback iteration
5. **Pricing** — `{{estimated_pricing}}`; scope changes will be adjusted together
6. **Next Steps** — agreement to formalise; reach out with questions; "Looking forward to working
   together."

Header: `# Proposal for {{client_name}}` / `Prepared by {{salesperson_name}}` /
`Date: {{date_of_call}}`. Sign-off: `Warm regards, {{salesperson_name}}, Koya Talent`.

Note which placeholders are **verbatim intake fields** (`project_scope`, `proposed_timeline`,
`estimated_pricing`) versus **generated prose** (`recommended_approach`, and the framing sentences
around each field). `{{deliverables}}` is a formatted rendering of `recommended_services`, not an
invention.

### 4.3 Client email template

**Subject:** `Proposal for {{company_name}}`

Body: greets `{{client_name}}`; thanks them for their time; says a customized proposal has been
put together based on the conversation; gives `{{proposal_link}}`; notes the document covers
scope, timeline, pricing and approach; invites questions and offers to iterate; signs off from
`{{salesperson_name}}`, Koya Talent.

Wording may be adapted if it stays professional and matches the generated proposal.

---

## 5. Proposed schema

Not yet run. Review before executing.

```sql
-- One row per proposal
create table proposals (
  id uuid primary key default gen_random_uuid(),
  share_token text unique not null default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','rejected','sent')),

  -- intake fields, stored verbatim
  client_name text,
  client_email text,
  company_name text,
  date_of_call date,
  salesperson_name text,
  client_needs_summary text,
  project_scope text,
  goals_and_objectives text,
  recommended_services text,
  proposed_timeline text,
  estimated_pricing text,
  supporting_material text,

  missing_fields text[] not null default '{}',

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

-- One row per section, so regenerating one does not touch the others
create table proposal_sections (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  key text not null,          -- introduction | proposed_solution | deliverables
                              -- | timeline | pricing | next_steps
  position int not null,
  content text,
  generated_at timestamptz,
  edited_by_human boolean not null default false,
  unique (proposal_id, key)
);

-- Approval decisions
create table proposal_approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected')),
  comment text,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now()
);

-- Audit trail. This is what makes test scenario 7 answerable.
create table proposal_events (
  id bigserial primary key,
  proposal_id uuid references proposals(id) on delete cascade,
  event text not null,        -- generated | section_regenerated | submitted | approved
                              -- | rejected | pdf_built | email_sent | email_failed
  ok boolean not null default true,
  detail jsonb,
  at timestamptz not null default now()
);
```

**Why sections are their own table.** Test scenario 4 requires regenerating one section without
losing the rest. If the proposal is one blob of text, regeneration means asking the model to
rewrite everything and hoping it leaves the other parts alone — which it will not reliably do. One
row per section makes "regenerate section 2" a single-row update, and it is provable rather than
hopeful.

**Why `proposal_events` exists.** Test scenario 7 asks that failures be clear enough to debug. In
Week 2 the two worst bugs both occurred while the workflow reported success; a green tick is not
evidence. Every step writes an event with `ok` true or false and a `detail` payload, so a failed
PDF build or a bounced email is a row you can look at rather than something inferred from absence.

### RLS

```sql
alter table proposals          enable row level security;
alter table proposal_sections  enable row level security;
alter table proposal_approvals enable row level security;
alter table proposal_events    enable row level security;

-- Staff (any signed-in user) can work with proposals
create policy "staff read proposals"   on proposals for select to authenticated using (true);
create policy "staff write proposals"  on proposals for insert to authenticated with check (true);
create policy "staff update proposals" on proposals for update to authenticated using (true);
-- Equivalent select/insert/update policies on proposal_sections,
-- proposal_approvals and proposal_events.
```

**The client-facing page is the hard part.** The client is not signed in, so `authenticated`
policies cannot serve them, and a policy that lets `anon` read `proposals` would expose every
proposal to anyone holding the public key.

The clean solution is a `security definer` function that takes the token and returns exactly one
proposal:

```sql
create or replace function public.get_proposal_by_token(t text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'proposal', to_jsonb(p) - 'share_token' - 'created_by',
    'sections', (select json_agg(s order by s.position)
                 from proposal_sections s where s.proposal_id = p.id)
  )
  from proposals p
  where p.share_token = t
    and p.status = 'sent';
$$;

revoke all on function public.get_proposal_by_token(text) from public;
grant execute on function public.get_proposal_by_token(text) to anon;
```

Note the two conditions: the token must match **and** the status must be `sent`. A draft is
unreachable even if someone has its token. The token is stripped from the returned object so it
cannot leak onward.

### Enforcing the approval gate in the database

Hiding the Send button until approved is the fake-login mistake in another costume. The gate must
be enforced where it cannot be bypassed:

```sql
create or replace function public.enforce_approval_before_send()
returns trigger language plpgsql as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    if not exists (
      select 1 from proposal_approvals a
      where a.proposal_id = new.id and a.decision = 'approved'
    ) then
      raise exception 'Cannot send a proposal that has not been approved';
    end if;
    if array_length(new.missing_fields, 1) > 0 then
      raise exception 'Cannot send a proposal with missing required fields';
    end if;
  end if;
  return new;
end $$;

create trigger trg_enforce_approval
  before update on proposals
  for each row execute function public.enforce_approval_before_send();
```

The serverless send function should also check status server-side before calling the email
provider — but this trigger is what makes the guarantee real. Worth demonstrating on video: try to
force a send on an unapproved proposal and watch the database refuse it.

---

## 6. Application shape

### Routes

| Route | Who | Purpose |
|---|---|---|
| `/` | staff | List of proposals with status |
| `/new` | staff | Intake form |
| `/proposal/:id` | staff | Review, edit, regenerate sections, submit for approval |
| `/review/:id` | reviewer | Approve or reject with a comment |
| `/p/:token` | public | Client-facing proposal page |

### Serverless functions (`api/`)

| Function | Does |
|---|---|
| `generate.ts` | Calls Claude to produce all six sections from the intake fields |
| `regenerate.ts` | Regenerates one section, given its key plus optional steer text |
| `send.ts` | Verifies session, verifies status is `approved`, builds the email from the template, sends via Resend, writes an event |
| `pdf.ts` | Renders the proposal to PDF |

**The Anthropic API key must live only in these functions**, read from `process.env`, never with a
`VITE_` prefix. In Weeks 1 and 2 it was held in n8n's credential store; there is no credential
store here, and a key with a `VITE_` prefix is compiled into the browser bundle where anyone can
read it and spend against it.

### Environment variables

| Name | Where | Type |
|---|---|---|
| `VITE_SUPABASE_URL` | browser + functions | Config (public) |
| `VITE_SUPABASE_ANON_KEY` | browser + functions | Config (public) |
| `ANTHROPIC_API_KEY` | functions only | **Secret** |
| `RESEND_API_KEY` | functions only | **Secret** |
| `PUBLIC_BASE_URL` | functions only | Config — used to build `{{proposal_link}}` |

Vercel refuses to store a `VITE_`-prefixed variable as Secret, which is the platform telling you
the prefix means public. Confirm `.env` is gitignored and grep `dist/` for `ANTHROPIC` and
`RESEND` after building.

---

## 7. Claude generation

### Model choice — decide deliberately, do not inherit

Week 2 used Haiku, correctly: the model received finished numbers and wrote a short internal
summary. **This task is different and the answer may be different.** The output is client-facing
commercial prose that carries the company's reputation, volume is low (a handful of proposals a
day, not three scheduled runs), and a salesperson is waiting so latency is felt but a few extra
seconds are acceptable for a document someone will spend minutes reading.

That argues for **Sonnet on the initial generation**, where prose quality is the product, with
Haiku a reasonable choice for cheap per-section regeneration. Whichever is chosen, the reflection
answer should say why, name the alternative, and weigh quality, cost, latency and complexity —
and "I used the same model as last week" is not a reason.

### Prompt design

One call generates all six sections and returns JSON keyed by section. Regeneration sends the same
context plus the single section key and any steer the salesperson typed.

Non-negotiable instructions:

- Verbatim fields are reproduced **exactly as supplied**. Do not rephrase a price, a timeline, or
  a scope statement. They may be formatted (a list rendered as bullets) but not reworded.
- **Never invent a commitment.** No number, duration, deliverable, guarantee, discount or
  capability that is not in the input. If a required field is empty, write nothing in its place —
  the application inserts a marker.
- No claims about the company's experience, client roster, certifications or past results. None of
  that is in the input.
- Professional and warm, not effusive. No superlatives, no "cutting-edge", no "revolutionary".
- Supporting material, when provided, may be drawn on for context and specificity — but it is
  reference, not a source of new commitments.

Return strict JSON: `{ "introduction": "...", "proposed_solution": "...", ... }`.

**The verification that matters:** after generation, check programmatically that every verbatim
field appears in the output unmodified. If `estimated_pricing` reads "$12,000–$15,000" and the
generated pricing section says "$12,000 to $15,000", the model has rewritten a commitment. Catch
it in code rather than trusting the instruction — that is the whole lesson from Week 2's four
prompt iterations.

---

## 8. Missing information handling

On submit, compute `missing_fields` from the four required commitments. Then:

1. Each missing field renders in the proposal as a visible marker — e.g. a highlighted
   `[ Timeline not provided — to be confirmed ]` block, not a blank and not prose.
2. The review screen lists what is missing at the top.
3. Approval is blocked while `missing_fields` is non-empty, enforced by the trigger above.
4. The generation prompt is told which fields are absent and instructed to write around them
   without filling them.

Point 4 alone is insufficient — a model asked to write a proposal with no timeline will often
supply one anyway. Points 1 to 3 are what make it safe.

---

## 9. Test scenarios and how each is satisfied

| # | Scenario | Design that satisfies it |
|---|---|---|
| 1 | Normal generation | Complete intake produces six sections with verbatim fields intact |
| 2 | Missing information | `missing_fields`, visible markers, approval blocked, no invented values |
| 3 | Supporting material | `supporting_material` passed as context; visible in the specificity of the generated prose |
| 4 | Section regeneration | Per-section rows; regenerating one updates one row, others untouched and provably unchanged |
| 5 | Human approval | Trigger refuses a send without an approval row; server-side check in `send.ts` as well |
| 6 | Delivery and logging | Resend send, `sent_at` set, `proposal_events` row written, proposal listed in the central table |
| 7 | Failure handling | Every step writes an event with `ok` and a `detail` payload; UI surfaces the failure rather than a generic error |

For scenario 4, take a hash of the other five sections before and after regenerating one. Equal
hashes are evidence; "it looked the same" is not.

---

## 10. Build order

1. Schema, RLS, the token function, the approval trigger
2. Auth (lift from the Week 2 app — same pattern, sign-ups disabled, users by hand) plus a
   reviewer role
3. Intake form saving a draft, with `missing_fields` computed
4. `generate.ts` and the six sections
5. Review screen — edit, regenerate one section, submit for approval
6. Reviewer screen — approve or reject with a comment
7. Public proposal page at `/p/:token`
8. PDF export
9. `send.ts` with Resend, plus logging
10. Failure paths, events surfaced in the UI, evidence table

Each step is testable alone. That matters: in Week 2 the two worst bugs — an 8× overstated figure
and a truncated batch insert — both happened while the system reported success. Verify each step
against something you worked out yourself, not against the absence of a red error.

---

## 11. Lessons carried from Weeks 1 and 2

- **Constrain the input, not the model's behaviour.** Three rounds of prompt instructions failed
  to stop Claude dramatising a figure; suppressing the misleading number in code fixed it at once.
  Here that means verbatim fields verified programmatically and missing fields blocked structurally.
- **"No errors" and "correct" are unrelated claims.** Both of Week 2's serious bugs reported
  success. Check outputs against hand-worked expectations.
- **Put the gate where it cannot be bypassed.** A UI that hides a button is not a control. The
  approval gate belongs in the database.
- **Absence must look like absence.** Null is not zero; a missing timeline is not "4–6 weeks".
- **A public link is a credential.** The share token is the only thing protecting a client's
  proposal, so it must be long, random, and scoped to `sent` proposals only.
