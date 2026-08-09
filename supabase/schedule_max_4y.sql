-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Cap scheduled posts at 4 years out (server-side)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after supabase/gifs_polls_scheduling.sql has been run at least
-- once, since that's what adds posts.scheduled_at).
-- Safe to re-run.
--
-- The client already blocks picking a date more than 4 years out
-- (see toggleScheduleBuilder/collectSchedule/validatePollAndSchedule
-- in js/common.js), but that's only a UI nicety — anyone can bypass
-- it by calling the API directly. This is the enforcement that
-- actually matters.
-- ═══════════════════════════════════════════════════════════════════
alter table public.posts drop constraint if exists posts_scheduled_at_max_check;
alter table public.posts add constraint posts_scheduled_at_max_check
  check (scheduled_at is null or scheduled_at <= now() + interval '4 years');

notify pgrst, 'reload schema';
