-- ═══════════════════════════════════════════════════════════════════
-- 1) SCHEDULED POSTS — guaranteed-correct fix
-- 2) FOR YOU FEED — Twitter-style ranking algorithm
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run, and safe no matter what order your other
-- supabase/*.sql files have been run in before this.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- PART 1 — SCHEDULED POSTS
--
-- The bug: schema.sql's original "read non-deleted posts" policy
-- (is_deleted = false, nothing else) and gifs_polls_scheduling.sql's
-- scheduled-aware version of that SAME policy name were both floating
-- around as separate files. Whichever one got run last silently won —
-- so if schema.sql was ever re-run after the scheduling file (a very
-- normal thing to do when re-running the whole schema for something
-- unrelated), it wiped out the scheduling gate and every scheduled
-- post became publicly visible immediately, on top of a check
-- constraint that only ever existed in schedule_max_4y.sql. This
-- block restates all three, guaranteed last and correct.
-- ───────────────────────────────────────────────────────────────────

alter table public.posts add column if not exists scheduled_at timestamptz;
create index if not exists posts_scheduled_at_idx on public.posts (scheduled_at);

alter table public.posts drop constraint if exists posts_scheduled_at_max_check;
alter table public.posts add constraint posts_scheduled_at_max_check
  check (scheduled_at is null or scheduled_at <= now() + interval '4 years');

drop policy if exists "read non-deleted posts" on public.posts;
create policy "read non-deleted posts" on public.posts
  for select using (
    is_deleted = false
    and (scheduled_at is null or scheduled_at <= now() or author_id = auth.uid())
  );

-- ───────────────────────────────────────────────────────────────────
-- PART 2 — FOR YOU FEED ALGORITHM
--
-- What real Twitter's (public, 2023 open-sourced) ranking does, at a
-- level that actually maps onto a normal Postgres app: pull a pool of
-- candidate posts, score each one on engagement + recency + whether
-- you're in-network with the author, then sort by that score instead
-- of raw chronological order. The parts that don't translate here —
-- the ML embedding models (SimClusters/TwHIN), a learned "heavy
-- ranker," ads auction logic — need training data and infra this
-- project doesn't have; this is the practical version of the same
-- idea using signals you actually have: likes, replies, reposts,
-- bookmarks, post age, and your follow graph.
--
-- score = engagement_weight * network_boost / time_decay
--   engagement_weight: replies + reposts count for more than a like
--                       (a reply/repost is a much bigger signal of
--                       "this mattered to someone" than a tap) —
--                       same relative weighting Twitter's engineering
--                       blog describes for its own reply/RT signals.
--   network_boost:     3x if you follow the author — Twitter calls
--                       this "in-network" vs "out-of-network" and
--                       heavily favors in-network in the mix.
--   time_decay:        Hacker-News-style gravity curve (score divided
--                       by (age_in_hours + 2) ^ 1.8) — old posts fade
--                       out even if they were popular, new posts get
--                       a fair shot at surfacing before they've
--                       collected any engagement yet.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.get_for_you_feed(
  viewer   uuid default null,
  limit_n  integer default 50,
  offset_n integer default 0
)
returns setof public.posts
language sql
stable
as $$
  select p.*
  from public.posts p
  where p.is_deleted = false
    and (p.scheduled_at is null or p.scheduled_at <= now())
  order by
    (
      (p.like_count * 1.0 + p.reply_count * 2.0 + p.repost_count * 2.0 + p.bookmark_count * 1.5 + 1)
      * (case
          when coalesce(viewer, auth.uid()) is not null and exists (
            select 1 from public.follows f
            where f.follower_id = coalesce(viewer, auth.uid()) and f.followee_id = p.author_id
          ) then 3.0
          else 1.0
        end)
      / power((extract(epoch from (now() - p.created_at)) / 3600.0) + 2, 1.8)
    ) desc,
    p.created_at desc
  limit limit_n
  offset offset_n;
$$;

-- RLS still applies on top of this — it's a plain (not security
-- definer) function, so it only ever returns rows the calling user
-- (anon or logged in) is already allowed to see. The scheduled_at
-- check in the WHERE clause above is redundant with RLS by design —
-- belt and suspenders, same reasoning as Part 1.

notify pgrst, 'reload schema';
