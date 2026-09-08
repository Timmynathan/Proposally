-- Koya Proposals — Phase 3 migration. Run once in the Supabase SQL editor,
-- after schema.sql and phase2-migration.sql. Additive only — does not touch
-- existing data.

-- ============================================================================
-- Staff can delete proposals
--
-- No delete policy existed on `proposals` (or proposal_sections /
-- proposal_approvals / proposal_events, which cascade off it), so RLS denied
-- every delete by default — the new Delete action on the proposals list would
-- silently affect 0 rows without this. Matches the existing "any staff member
-- can act on any proposal" permission model already used for insert/update.
-- ============================================================================

create policy "staff delete proposals" on proposals
  for delete to authenticated
  using (true);
