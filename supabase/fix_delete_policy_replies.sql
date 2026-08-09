-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Fix: can't delete your own replies/comments (RLS
-- policy for UPDATE on public.replies missing or never committed).
--
-- This is the same class of issue fix_delete_policy.sql fixes for
-- public.posts, just for public.replies. Run this ENTIRE file, BY
-- ITSELF, in a fresh Supabase SQL Editor query. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ── STEP 1: what does the database actually have right now? ──
-- You're looking for a row where policyname = 'users can edit own
-- replies' and cmd = 'UPDATE'. If it's missing, that's why deletes
-- fail — the frontend does a soft-delete UPDATE (is_deleted = true),
-- and with no UPDATE policy, RLS blocks it by default.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'replies'
order by cmd, policyname;

-- ── STEP 2: force RLS on and rebuild every replies policy from a
-- known good state. ──
alter table public.replies enable row level security;

drop policy if exists "read non-deleted replies" on public.replies;
create policy "read non-deleted replies" on public.replies
  for select using (is_deleted = false);

drop policy if exists "logged in users can reply" on public.replies;
create policy "logged in users can reply" on public.replies
  for insert with check (auth.uid() = author_id);

drop policy if exists "users can edit own replies" on public.replies;
create policy "users can edit own replies" on public.replies
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- ── STEP 3: confirm it took. Should now show 3 rows: SELECT, INSERT,
-- UPDATE. ──
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'replies'
order by cmd, policyname;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- Note: the missing UPDATE policy was only half the bug. The other
-- half was in the frontend — the Delete button was never even being
-- rendered for your own replies/comments (it hard-coded "no delete
-- on replies", and where it did try, it pointed at the wrong table).
-- That's fixed in this same update: js/common.js, js/thread.js,
-- js/profile.js.
-- ═══════════════════════════════════════════════════════════════════
