-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Community creator permissions + post character limit
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql and communities.sql have already been run).
-- Safe to re-run.
--
-- What this does:
--   1. Adds communities.avatar_url so a community can have a picture,
--      and lets the community's creator (created_by) update their own
--      community row (to change that avatar, name, or description).
--   2. Lets the community's creator delete ANY post inside their own
--      community, not just their own posts — same idea as a
--      moderator, done by widening delete_own_post() rather than
--      touching posts' RLS policy.
--   3. Shrinks the max length of a POST (posts.body) from 4000 to
--      500 characters. Replies/comments get the same 500-char limit
--      via the separate reply_char_limit.sql migration.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Community avatar + creator can edit their own community ──

alter table public.communities add column if not exists avatar_url text;

drop policy if exists "creator can update own community" on public.communities;
create policy "creator can update own community" on public.communities
  for update using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- ── 2. delete_own_post() also allows the creator of a post's
-- community to delete it (comments/replies are unaffected — 
-- delete_own_reply() below is unchanged). ──

create or replace function public.delete_own_post(post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner   uuid;
  comm_id uuid;
  comm_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select author_id, community_id into owner, comm_id from public.posts where id = post_id;

  if owner is null then
    raise exception 'Post not found';
  end if;

  if owner = auth.uid() then
    update public.posts set is_deleted = true where id = post_id;
    return;
  end if;

  if comm_id is not null then
    select created_by into comm_owner from public.communities where id = comm_id;
    if comm_owner is not null and comm_owner = auth.uid() then
      update public.posts set is_deleted = true where id = post_id;
      return;
    end if;
  end if;

  raise exception 'You can only delete your own posts (or posts in a community you created)';
end;
$$;

revoke all on function public.delete_own_post(uuid) from public;
grant execute on function public.delete_own_post(uuid) to authenticated;

-- delete_own_reply() is intentionally left as-is (fix_delete_via_rpc.sql) —
-- community creators can delete POSTS in their community, not comments.

-- ── 3. Posts shrink to a 500 character max. ──
-- (This will fail if any existing post is already longer than 500
-- chars — trim/delete those rows first if this errors out.)

alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts add constraint posts_body_check check (char_length(body) between 1 and 500);

notify pgrst, 'reload schema';
