-- Koya Proposals — schema for Phase 1 (schema, auth, intake, generation).
-- Written to be run once in the Supabase SQL editor. Not executed by the app.
--
-- This is the schema from week3-handoff.md section 5, unchanged, plus one addition:
-- a `staff` table for the reviewer role (see note above that block). No other changes —
-- see the build summary for the one piece of optional polish (indexes) that was left out
-- deliberately rather than added silently.

-- ============================================================================
-- Core tables
-- ============================================================================

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

-- Helpful for listing/lookup patterns used by the app (/ , /proposal/:id, event history).
-- Not in the original proposal — added because every one of these tables is queried by
-- proposal_id or share_token and Postgres won't use an index that doesn't exist.
create index idx_proposal_sections_proposal_id on proposal_sections(proposal_id);
create index idx_proposal_approvals_proposal_id on proposal_approvals(proposal_id);
create index idx_proposal_events_proposal_id on proposal_events(proposal_id);
create index idx_proposals_share_token on proposals(share_token);

-- ============================================================================
-- Staff / roles
--
-- Reviewer role: a `staff` table mapping auth user id -> role, rather than an
-- app_metadata claim. Reasoning:
--   - app_metadata requires the admin API (service role) or a direct write to
--     auth.users to set, and doesn't show up anywhere in Studio's table view —
--     you'd be editing an internal auth table by hand with no UI for it.
--   - a plain table is visible and editable in Studio like any other data,
--     which matters here since "users are provisioned by hand."
--   - it's trivial to extend (add a name, a team, more roles) without touching
--     Supabase auth internals.
-- Trade-off: role isn't embedded in the JWT, so an RLS policy that needs to check
-- role has to join to this table (see proposal_approvals note below) instead of
-- reading auth.jwt(). For two roles at this scale that's a non-issue. If this
-- needed to scale to many roles/permissions checked on every request, moving the
-- role into app_metadata (synced to this table via a trigger) would avoid the join.
-- ============================================================================

create table staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('sales','reviewer')) default 'sales',
  display_name text,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- Any signed-in user can read the staff table (needed to check their own role,
-- and Phase 2's reviewer screen needs to show who decided what).
create policy "staff read staff" on staff for select to authenticated using (true);

-- No insert/update/delete policy for staff — provisioning is done by hand via the
-- Supabase SQL editor (service role), which bypasses RLS. This is deliberate:
-- role assignment should not be self-service from the app.

-- Example provisioning, run by hand after creating each user in Authentication -> Users:
--   insert into staff (user_id, role, display_name)
--   values ('<uuid-from-auth-users>', 'reviewer', 'Jordan Reviewer');

-- ============================================================================
-- RLS — proposals, sections, approvals, events
-- ============================================================================

alter table proposals          enable row level security;
alter table proposal_sections  enable row level security;
alter table proposal_approvals enable row level security;
alter table proposal_events    enable row level security;

-- Staff (any signed-in user) can work with proposals
create policy "staff read proposals"   on proposals for select to authenticated using (true);
create policy "staff write proposals"  on proposals for insert to authenticated with check (true);
create policy "staff update proposals" on proposals for update to authenticated using (true);

create policy "staff read sections"  on proposal_sections for select to authenticated using (true);
create policy "staff write sections" on proposal_sections for insert to authenticated with check (true);
create policy "staff update sections" on proposal_sections for update to authenticated using (true);

create policy "staff read approvals"  on proposal_approvals for select to authenticated using (true);
create policy "staff write approvals" on proposal_approvals for insert to authenticated with check (true);

create policy "staff read events"  on proposal_events for select to authenticated using (true);
create policy "staff write events" on proposal_events for insert to authenticated with check (true);

-- Phase 2 note: once the reviewer screen exists, "staff write approvals" is worth
-- tightening to check the caller has role = 'reviewer' in the staff table, e.g.:
--   with check (exists (select 1 from staff where user_id = auth.uid() and role = 'reviewer'))
-- Left as `true` for now because Phase 1 has no approval UI yet to test it against.

-- ============================================================================
-- Public token access — the client-facing page has no signed-in user
-- ============================================================================

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

-- ============================================================================
-- Approval gate — enforced in the database, not just the UI
-- ============================================================================

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
