-- Koya Proposals — Phase 4 migration. Run once in the Supabase SQL editor,
-- after schema.sql, phase2-migration.sql and phase3-delete-policy.sql.
-- Additive only — does not touch existing data or existing policies.

-- ============================================================================
-- Reading email addresses for internal notifications
--
-- api/submit.ts and api/decide.ts run scoped to the caller's own JWT (not a
-- service-role key), the same as every other function in this app. But
-- auth.users isn't exposed through PostgREST, so there is no REST call that
-- can turn "this reviewer's staff row" or "this proposal's created_by" into
-- an email address to send to.
--
-- These two functions are the same pattern as get_proposal_by_token in
-- schema.sql: a narrow, purpose-built, security-definer read into auth.users
-- that hands back only an email address, never the row itself, and only to
-- a signed-in user. Restricted to ids that actually have a `staff` row (not
-- just any auth.users id), so this can't be repurposed as a generic
-- "any user's email by id" lookup beyond this app's own internal staff.
-- ============================================================================

create or replace function public.get_reviewer_emails()
returns table (user_id uuid, email text, display_name text)
language sql
security definer
set search_path = public
as $$
  select s.user_id, u.email, s.display_name
  from staff s
  join auth.users u on u.id = s.user_id
  where s.role = 'reviewer';
$$;

revoke all on function public.get_reviewer_emails() from public;
grant execute on function public.get_reviewer_emails() to authenticated;

create or replace function public.get_staff_email(target_user_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select u.email
  from auth.users u
  where u.id = target_user_id
    and exists (select 1 from staff s where s.user_id = u.id);
$$;

revoke all on function public.get_staff_email(uuid) from public;
grant execute on function public.get_staff_email(uuid) to authenticated;
