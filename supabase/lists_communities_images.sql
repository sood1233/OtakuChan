-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — List pictures/banners + community banners
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after lists.sql and communities.sql/community_creator_and_post_limit.sql
-- have already been run). Safe to re-run.
--
-- What this does:
--   1. Adds lists.avatar_url + lists.banner_url so a List can have a
--      picture and banner, same as a profile or community. No new
--      RLS policy is needed — "owner can update their own list"
--      (lists.sql) already covers any column on an UPDATE.
--   2. Adds communities.banner_url (avatar_url already existed —
--      see community_creator_and_post_limit.sql). Same story:
--      "creator can update own community" already covers it.
--   3. Both reuse the existing `avatars` storage bucket via
--      uploadAvatar() — that bucket's RLS only cares that a file is
--      written inside the *acting user's own* <uid> folder, not what
--      the URL ends up attached to, so no storage-policy change is
--      needed either.
-- ═══════════════════════════════════════════════════════════════════

alter table public.lists add column if not exists avatar_url text;
alter table public.lists add column if not exists banner_url text;

alter table public.communities add column if not exists banner_url text;
