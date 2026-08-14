-- Likely root cause of "phone shows liked, laptop never does, even
-- after reload": the `likes` table has no (or an incorrect) Row Level
-- Security SELECT policy for authenticated users to read their own
-- rows. RLS doesn't error when it blocks a read — it just returns
-- zero rows — so ensureLikesLoaded() in js/common.js silently gets an
-- empty result on every page load, no matter what's actually in the
-- table, and every device renders every post as "not liked" until you
-- personally tap it (which only ever LOOKS liked locally, via the
-- optimistic UI, not because the read is actually working).
--
-- Run this in the Supabase SQL editor. It's safe to run even if some
-- of these policies already exist — each one is dropped and recreated
-- so you end up with exactly this set, not a duplicate.

alter table public.likes enable row level security;

-- Read: a logged-in user can see their OWN like rows (this is what
-- ensureLikesLoaded() needs — it filters by user_id itself, but RLS
-- still has to allow the read through in the first place).
drop policy if exists "likes_select_own" on public.likes;
create policy "likes_select_own"
  on public.likes for select
  to authenticated
  using (user_id = auth.uid());

-- Write: a logged-in user can only ever like as themselves.
drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own"
  on public.likes for insert
  to authenticated
  with check (user_id = auth.uid());

-- Unlike: only your own like rows.
drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own"
  on public.likes for delete
  to authenticated
  using (user_id = auth.uid());

-- ── Sanity check ──
-- Run this next and confirm it lists the three policies above with
-- "PERMISSIVE" and the roles/quals shown here. If it comes back empty,
-- RLS is enabled but had zero policies — meaning it was blocking every
-- read/write outright, which is the exact bug this fixes.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'likes';

-- ── If that's not it either ──
-- Run this as yourself (logged in) to see directly what your own
-- SELECT actually returns — compare the count to how many posts you
-- can see highlighted as liked:
--   select * from public.likes where user_id = auth.uid();
-- If that comes back empty even after the policies above are in
-- place, the issue isn't likes at all — it's that `auth.uid()` isn't
-- matching your session (worth checking you're not somehow signed in
-- as two different accounts across phone/laptop, or that a session
-- token is stale in one browser — try signing out and back in on the
-- laptop).
