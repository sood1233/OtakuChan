-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Fix: "new row violates row-level security policy for
-- table posts" when deleting your own post.
--
-- Run this ENTIRE file, BY ITSELF, in a fresh Supabase SQL Editor
-- query (don't paste it into the middle of a bigger script — see
-- the note at the bottom on why that matters). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ── STEP 1: what does the database actually have right now? ──
-- Run this block first and look at the output before going further.
-- You're looking for a row where policyname = 'users can edit own
-- posts' and cmd = 'UPDATE'. If that row is missing, the policy
-- never actually got created/committed on this project — which is
-- the #1 cause of this exact error.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'posts'
order by cmd, policyname;

-- ── STEP 2: force RLS on and rebuild every posts policy from a known
-- good state. This doesn't change behavior if everything was already
-- correct — it just guarantees it, regardless of what step 1 showed. ──
alter table public.posts enable row level security;

drop policy if exists "read non-deleted posts" on public.posts;
create policy "read non-deleted posts" on public.posts
  for select using (
    is_deleted = false
    and (scheduled_at is null or scheduled_at <= now() or author_id = auth.uid())
  );

drop policy if exists "logged in users can post" on public.posts;
create policy "logged in users can post" on public.posts
  for insert with check (auth.uid() = author_id);

drop policy if exists "users can edit own posts" on public.posts;
create policy "users can edit own posts" on public.posts
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- ── STEP 3: confirm it took. Should now show 3 rows: SELECT, INSERT,
-- UPDATE, each scoped the way you'd expect. ──
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'posts'
order by cmd, policyname;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- Why this keeps happening: Supabase's SQL Editor runs a pasted
-- multi-statement script as ONE implicit transaction. If any single
-- statement anywhere in a big script errors, Postgres rolls back the
-- WHOLE batch — including policies defined earlier in that same
-- paste that looked like they ran fine. Running this short file on
-- its own, isolated, removes that risk entirely.
--
-- If step 3 shows the right 3 rows and deleting still fails, the
-- next most likely cause isn't the policy at all — it's that the
-- browser session is stale (signed in a while ago, token expired).
-- Sign out, sign back in, and try the delete again before re-running
-- this file.
-- ═══════════════════════════════════════════════════════════════════
