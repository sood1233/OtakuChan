-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Delete via SECURITY DEFINER function instead of a raw
-- client-side UPDATE + RLS policy.
--
-- Why: the soft-delete (is_deleted = true) previously relied on the
-- "users can edit own posts" RLS UPDATE policy matching on every
-- write. If that keeps throwing "new row violates row-level security
-- policy for table posts" even after the policy is rebuilt correctly,
-- something else in this project's live policy state (a leftover
-- restrictive policy, a stale definition from an earlier manual edit,
-- etc.) is interfering in a way that isn't visible from the schema
-- files alone.
--
-- This routes the delete through a function that instead:
--   1. Checks you're logged in and that you actually own the row,
--      in plain SQL, right here — not relying on RLS to enforce it.
--   2. Runs SECURITY DEFINER, so it executes with the function
--      owner's privileges and bypasses the posts/replies table RLS
--      entirely for its own UPDATE — whatever is wrong with those
--      policies no longer matters for this path.
--   3. Is only callable by logged-in (authenticated) users, and only
--      ever touches the one row it just verified you own.
--
-- Run this whole file, by itself, in the SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.delete_own_post(post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select author_id into owner from public.posts where id = post_id;

  if owner is null then
    raise exception 'Post not found';
  end if;
  if owner <> auth.uid() then
    raise exception 'You can only delete your own posts';
  end if;

  update public.posts set is_deleted = true where id = post_id;
end;
$$;

revoke all on function public.delete_own_post(uuid) from public;
grant execute on function public.delete_own_post(uuid) to authenticated;

create or replace function public.delete_own_reply(reply_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select author_id into owner from public.replies where id = reply_id;

  if owner is null then
    raise exception 'Reply not found';
  end if;
  if owner <> auth.uid() then
    raise exception 'You can only delete your own replies';
  end if;

  update public.replies set is_deleted = true where id = reply_id;
end;
$$;

revoke all on function public.delete_own_reply(uuid) from public;
grant execute on function public.delete_own_reply(uuid) to authenticated;

-- Confirm both functions exist with the right owner/security mode.
select proname, prosecdef as is_security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('delete_own_post', 'delete_own_reply');

notify pgrst, 'reload schema';
