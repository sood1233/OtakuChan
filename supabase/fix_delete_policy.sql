-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Fix: "new row violates row-level security policy for
-- table posts" when deleting your own post.
--
-- Run this by itself in: Supabase Dashboard → SQL Editor → New query.
--
-- Why this happens: schema.sql already defines the right policy
-- ("users can edit own posts" — auth.uid() = author_id), but if it
-- was pasted as part of one giant script and ANYTHING later in that
-- script errored, Postgres rolls back the *entire* batch as a single
-- implicit transaction — including this policy — even though earlier
-- lines looked like they succeeded. Running just this one policy by
-- itself removes that risk. Safe to re-run any time.
-- ═══════════════════════════════════════════════════════════════════

alter table public.posts enable row level security;

drop policy if exists "users can edit own posts" on public.posts;
create policy "users can edit own posts" on public.posts
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- Sanity check — should list the policy above (cmd = 'UPDATE').
-- If this returns 0 rows after running the block above, RLS itself
-- is off for public.posts, or something is overriding it downstream.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'posts' and cmd = 'UPDATE';

notify pgrst, 'reload schema';
