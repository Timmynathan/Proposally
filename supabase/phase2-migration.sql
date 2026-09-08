-- Koya Proposals — Phase 2 migration. Run once in the Supabase SQL editor,
-- after supabase/schema.sql. Additive only — does not touch existing data.

-- ============================================================================
-- Reviewer-only approvals
--
-- schema.sql left "staff write approvals" as `with check (true)` — any signed-in
-- user could insert an approval row — with a note that Phase 2 should tighten it
-- once the reviewer screen actually exists to test against. It exists now.
-- ============================================================================

drop policy if exists "staff write approvals" on proposal_approvals;

create policy "reviewers write approvals" on proposal_approvals
  for insert to authenticated
  with check (
    exists (select 1 from staff where user_id = auth.uid() and role = 'reviewer')
  );
