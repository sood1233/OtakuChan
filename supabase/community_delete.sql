-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Let a community's creator delete the community itself
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after communities.sql and community_creator_and_post_limit.sql have
-- already been run). Safe to re-run.
--
-- What this does:
--   Adds the missing DELETE policy on public.communities. Editing a
--   community (name/description/avatar/banner) is already covered by
--   the "creator can update own community" UPDATE policy in
--   community_creator_and_post_limit.sql — this migration only adds
--   the DELETE half, so the creator (and only the creator) can also
--   remove the community entirely.
--
--   No extra cleanup code is needed: community_members, posts
--   (community_id), community_rules, and community_moderators were
--   all declared `references public.communities(id) on delete
--   cascade`, so deleting a community row already takes its
--   memberships, posts, rules, and moderator list with it.
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists "creator can delete own community" on public.communities;
create policy "creator can delete own community" on public.communities
  for delete using (auth.uid() = created_by);

notify pgrst, 'reload schema';
