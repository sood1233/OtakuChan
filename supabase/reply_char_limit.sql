-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Reply character limit
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql has already been run). Safe to re-run.
--
-- What this does:
--   Shrinks the max length of a REPLY (replies.body) from 4000 to
--   500 characters, matching the limit already applied to posts in
--   community_creator_and_post_limit.sql.
-- ═══════════════════════════════════════════════════════════════════

-- (This will fail if any existing reply is already longer than 500
-- chars — trim/delete those rows first if this errors out.)

alter table public.replies drop constraint if exists replies_body_check;
alter table public.replies add constraint replies_body_check check (char_length(body) between 1 and 500);

notify pgrst, 'reload schema';
