-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — GIFs, polls, and scheduled posts
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql — and quotes_and_reposts.sql if you've run it —
-- have already been run at least once).
-- Safe to re-run, same style as the rest of supabase/*.sql.
--
-- Design:
--   • GIFs reuse the existing media_url/media_type columns — a GIF is
--     just media_type = 'gif' pointing at a Giphy CDN URL, so every
--     existing renderMedia()/card path handles it for free once the
--     'gif' value is allowed through the check constraint.
--   • A poll is columns on the posts row itself (poll_options,
--     poll_ends_at) plus a public.poll_votes table (one row per
--     voter) — mirrors how likes/bookmarks are modeled.
--   • A scheduled post is a normal posts row with scheduled_at set in
--     the future. The "read non-deleted posts" policy is widened so
--     nobody but the author can see it until that time passes — no
--     cron job needed, it just becomes visible on its own.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- GIFS — widen the media_type check constraint on posts + replies.
-- ───────────────────────────────────────────────────────────────────
alter table public.posts   drop constraint if exists posts_media_type_check;
alter table public.posts   add constraint posts_media_type_check
  check (media_type is null or media_type in ('image','video','gif'));

alter table public.replies drop constraint if exists replies_media_type_check;
alter table public.replies add constraint replies_media_type_check
  check (media_type is null or media_type in ('image','video','gif'));

-- ───────────────────────────────────────────────────────────────────
-- POLLS
-- ───────────────────────────────────────────────────────────────────
alter table public.posts add column if not exists poll_options text[]
  check (poll_options is null or (array_length(poll_options, 1) between 2 and 4));
alter table public.posts add column if not exists poll_ends_at timestamptz;

create table if not exists public.poll_votes (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  option_index integer not null check (option_index >= 0 and option_index < 4),
  created_at   timestamptz not null default now(),
  unique (post_id, user_id) -- one vote per person, like every real poll
);
create index if not exists poll_votes_post_id_idx on public.poll_votes (post_id);

alter table public.poll_votes enable row level security;

drop policy if exists "read poll votes" on public.poll_votes;
create policy "read poll votes" on public.poll_votes
  for select using (true);

drop policy if exists "logged in users can vote" on public.poll_votes;
create policy "logged in users can vote" on public.poll_votes
  for insert with check (auth.uid() = user_id);

-- votes are final (no update/delete policy) — same as a real Twitter poll.

-- ───────────────────────────────────────────────────────────────────
-- SCHEDULED POSTS
-- ───────────────────────────────────────────────────────────────────
alter table public.posts add column if not exists scheduled_at timestamptz;
create index if not exists posts_scheduled_at_idx on public.posts (scheduled_at);

-- Widen the existing read policy so a post scheduled for the future
-- is invisible to everyone except its author until scheduled_at
-- passes (at which point it's just a normal, publicly-readable post —
-- no separate "publish" step or cron job required).
drop policy if exists "read non-deleted posts" on public.posts;
create policy "read non-deleted posts" on public.posts
  for select using (
    is_deleted = false
    and (scheduled_at is null or scheduled_at <= now() or author_id = auth.uid())
  );

do $$
begin
  alter publication supabase_realtime add table public.poll_votes;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
