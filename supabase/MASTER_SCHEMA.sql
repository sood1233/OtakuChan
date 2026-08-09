-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — MASTER SCHEMA (run this ONE file for everything)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste this
-- WHOLE file → Run. Safe to re-run any time, from any starting state
-- (fresh project or one that already has some of these files applied).
--
-- This is every supabase/*.sql file in this project, concatenated in
-- the order their dependencies require, plus a fix at the very bottom
-- for the exact error you hit ("could not find the function
-- get_for_you_feed..."): that function references repost_count and
-- bookmark_count, which only exist once quotes_and_reposts.sql and
-- bookmark_count.sql have run — and Supabase's SQL Editor runs a
-- whole pasted script as ONE transaction, so if that function's
-- CREATE failed, it silently rolled back everything else in the same
-- paste too, including fixes that looked fine. Running the individual
-- files in the wrong order (or re-running an old one) is exactly what
-- causes that. This file removes the ordering problem entirely by
-- putting everything in one correctly-ordered script.
--
-- The individual supabase/*.sql files still exist in this project for
-- reference/history, but you only need to run THIS file going
-- forward — it supersedes running them one by one.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/schema.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Supabase schema (accounts edition)
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout).
--
-- This replaces the old anonymous-posting schema. Posting now requires
-- a Supabase Auth account (email + password). Every post/reply/like is
-- tied to a row in public.profiles, which is tied 1:1 to auth.users.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────
-- PROFILES — one row per registered user, created automatically the
-- moment they sign up (see the trigger below). This is what makes
-- accounts possible: username, avatar, bio all live here.
-- ───────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name text check (display_name is null or char_length(display_name) <= 50),
  avatar_url   text,
  bio          text check (bio is null or char_length(bio) <= 200),
  created_at   timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (lower(username));

-- Denormalized follow counters, kept in sync by the follow triggers
-- further down. Added via ALTER so this file stays safe to re-run
-- against a profiles table that already existed before this feature.
alter table public.profiles add column if not exists followers_count integer not null default 0;
alter table public.profiles add column if not exists following_count integer not null default 0;
alter table public.profiles add column if not exists posts_count     integer not null default 0;

-- Auto-create a profile row whenever someone signs up. The username
-- comes from the "username" field passed in supabase.auth.signUp()'s
-- options.data — see js/auth.js. This runs as the table owner
-- (security definer), so it works even though the new user's session
-- isn't fully established yet and RLS would otherwise block the insert.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────────────────────────────────────────────
-- POSTS / REPLIES — now tied to an author_id instead of a free-text
-- "Anonymous" name. Username + avatar are read via a join to profiles.
-- ───────────────────────────────────────────────────────────────────

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles(id) on delete cascade,
  subject      text check (subject is null or char_length(subject) <= 120),
  body         text not null check (char_length(body) between 1 and 4000),
  media_url    text,
  media_type   text check (media_type is null or media_type in ('image','video')),
  like_count   integer not null default 0,
  reply_count  integer not null default 0,
  view_count   integer not null default 0,
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Safe on a pre-existing table too.
alter table public.posts add column if not exists view_count integer not null default 0;
-- BUGFIX: this column and its RLS gate below used to live only in
-- supabase/gifs_polls_scheduling.sql. Re-running this schema.sql file
-- after that one silently reverted the "read non-deleted posts"
-- policy back to a version with no scheduled_at check at all — which
-- made every scheduled post publicly visible immediately, defeating
-- scheduling entirely. Declaring it here too means that can't happen
-- again no matter what order the files get run in.
alter table public.posts add column if not exists scheduled_at timestamptz;
create index if not exists posts_scheduled_at_idx on public.posts (scheduled_at);

create table if not exists public.replies (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 4000),
  media_url    text,
  media_type   text check (media_type is null or media_type in ('image','video')),
  view_count   integer not null default 0,
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.replies add column if not exists view_count integer not null default 0;

-- Lets a reply be "in reply to" another reply (not just the OP), so
-- people can reply to each other's comments the same way they reply
-- to the thread itself. Null = top-level reply to the post.
alter table public.replies add column if not exists parent_reply_id uuid references public.replies(id) on delete cascade;
create index if not exists replies_parent_reply_id_idx on public.replies(parent_reply_id);

create table if not exists public.likes (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (post_id, user_id)
);

-- FOLLOWS — one row per "follower_id follows followee_id" relationship.
-- Drives the followers/following counts on profiles and, eventually,
-- a personalized feed if you want to add one later.
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  followee_id  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- Reports feed a private moderation queue. Logged-in users can insert
-- but never read — same idea as before, just tied to a real account
-- now instead of being fully anonymous.
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid references public.posts(id) on delete cascade,
  reply_id     uuid references public.replies(id) on delete cascade,
  reporter_id  uuid references public.profiles(id) on delete set null,
  reason       text not null check (reason in ('illegal','spam','doxxing','harassment','other')),
  details      text check (details is null or char_length(details) <= 500),
  created_at   timestamptz not null default now(),
  resolved     boolean not null default false
);

create index if not exists posts_created_at_idx    on public.posts (created_at desc);
create index if not exists posts_author_id_idx     on public.posts (author_id);
create index if not exists replies_post_id_idx     on public.replies (post_id);
create index if not exists replies_author_id_idx   on public.replies (author_id);
create index if not exists likes_post_id_idx       on public.likes (post_id);
create index if not exists likes_user_id_idx       on public.likes (user_id);
create index if not exists follows_follower_idx    on public.follows (follower_id);
create index if not exists follows_followee_idx    on public.follows (followee_id);
create index if not exists reports_resolved_idx    on public.reports (resolved);

-- ───────────────────────────────────────────────────────────────────
-- TRIGGERS — keep denormalized counters in sync
-- ───────────────────────────────────────────────────────────────────

-- profiles.posts_count — every post you author counts (quote posts
-- included, since a quote is just a normal posts row — see
-- quotes_and_reposts.sql), and it goes back down when you soft-delete
-- one. A backfill for accounts that already had posts before this
-- column existed runs right after the trigger is created below.
create or replace function public.on_post_insert_bump_count() returns trigger
language plpgsql security definer as $$
begin
  update public.profiles set posts_count = posts_count + 1 where id = new.author_id;
  return new;
end; $$;

drop trigger if exists trg_post_insert_bump_count on public.posts;
create trigger trg_post_insert_bump_count after insert on public.posts
for each row execute function public.on_post_insert_bump_count();

create or replace function public.on_post_soft_delete_bump_count() returns trigger
language plpgsql security definer as $$
begin
  if new.is_deleted = true and old.is_deleted = false then
    update public.profiles set posts_count = greatest(posts_count - 1, 0) where id = new.author_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_post_soft_delete_bump_count on public.posts;
create trigger trg_post_soft_delete_bump_count after update on public.posts
for each row execute function public.on_post_soft_delete_bump_count();

-- One-time backfill so accounts with posts predating this column show
-- the right number immediately instead of 0 until their next post.
-- Safe to re-run — it just recomputes the true count each time.
update public.profiles p set posts_count = (
  select count(*) from public.posts po where po.author_id = p.id and po.is_deleted = false
);

create or replace function public.on_reply_insert() returns trigger
language plpgsql security definer as $$
begin
  update public.posts set reply_count = reply_count + 1 where id = new.post_id;
  return new;
end; $$;

drop trigger if exists trg_reply_insert on public.replies;
create trigger trg_reply_insert after insert on public.replies
for each row execute function public.on_reply_insert();

create or replace function public.on_reply_soft_delete() returns trigger
language plpgsql security definer as $$
begin
  if new.is_deleted = true and old.is_deleted = false then
    update public.posts set reply_count = greatest(reply_count - 1, 0) where id = new.post_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_reply_soft_delete on public.replies;
create trigger trg_reply_soft_delete after update on public.replies
for each row execute function public.on_reply_soft_delete();

create or replace function public.on_like_insert() returns trigger
language plpgsql security definer as $$
begin
  update public.posts set like_count = like_count + 1 where id = new.post_id;
  return new;
end; $$;

drop trigger if exists trg_like_insert on public.likes;
create trigger trg_like_insert after insert on public.likes
for each row execute function public.on_like_insert();

create or replace function public.on_like_delete() returns trigger
language plpgsql security definer as $$
begin
  update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  return old;
end; $$;

drop trigger if exists trg_like_delete on public.likes;
create trigger trg_like_delete after delete on public.likes
for each row execute function public.on_like_delete();

-- follows: keep profiles.followers_count / following_count in sync
create or replace function public.on_follow_insert() returns trigger
language plpgsql security definer as $$
begin
  update public.profiles set following_count = following_count + 1 where id = new.follower_id;
  update public.profiles set followers_count = followers_count + 1 where id = new.followee_id;
  return new;
end; $$;

drop trigger if exists trg_follow_insert on public.follows;
create trigger trg_follow_insert after insert on public.follows
for each row execute function public.on_follow_insert();

create or replace function public.on_follow_delete() returns trigger
language plpgsql security definer as $$
begin
  update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  update public.profiles set followers_count = greatest(followers_count - 1, 0) where id = old.followee_id;
  return old;
end; $$;

drop trigger if exists trg_follow_delete on public.follows;
create trigger trg_follow_delete after delete on public.follows
for each row execute function public.on_follow_delete();

-- ───────────────────────────────────────────────────────────────────
-- VIEW COUNTS — bumped via RPC instead of a raw UPDATE, since the
-- posts/replies RLS update policies are scoped to "own rows only"
-- (see below) and viewing something isn't authorship. These run as
-- security definer so any visitor — logged in or not — can bump a
-- view count without needing a write policy of their own.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.increment_post_view(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.posts set view_count = view_count + 1 where id = p_id and is_deleted = false;
end; $$;

create or replace function public.increment_reply_views(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.replies set view_count = view_count + 1 where id = any(p_ids) and is_deleted = false;
end; $$;

grant execute on function public.increment_post_view(uuid)      to anon, authenticated;
grant execute on function public.increment_reply_views(uuid[])  to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Reads are public (anyone can browse the board without an account).
-- Writes (posts/replies/likes/reports) require a logged-in account,
-- and you can only write rows attached to your own profile id. Users
-- can also edit/soft-delete their own posts & replies, and unlike.
-- ───────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.replies  enable row level security;
alter table public.likes    enable row level security;
alter table public.follows  enable row level security;
alter table public.reports  enable row level security;

-- profiles: anyone can view any profile (it's a social site — public
-- profile pages). Only the owner can edit their own profile. Insert
-- is handled solely by the handle_new_user() trigger (security
-- definer), so there is no public insert policy on profiles at all.
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable" on public.profiles
  for select using (true);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- posts
drop policy if exists "read non-deleted posts" on public.posts;
create policy "read non-deleted posts" on public.posts
  for select using (
    is_deleted = false
    and (scheduled_at is null or scheduled_at <= now() or author_id = auth.uid())
  );

drop policy if exists "logged in users can post" on public.posts;
create policy "logged in users can post" on public.posts
  for insert with check (auth.uid() = author_id);

drop policy if exists "users can edit own posts" on public.posts;
create policy "users can edit own posts" on public.posts
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- replies
drop policy if exists "read non-deleted replies" on public.replies;
create policy "read non-deleted replies" on public.replies
  for select using (is_deleted = false);

drop policy if exists "logged in users can reply" on public.replies;
create policy "logged in users can reply" on public.replies
  for insert with check (auth.uid() = author_id);

drop policy if exists "users can edit own replies" on public.replies;
create policy "users can edit own replies" on public.replies
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- likes
drop policy if exists "read likes" on public.likes;
create policy "read likes" on public.likes
  for select using (true);

drop policy if exists "logged in users can like" on public.likes;
create policy "logged in users can like" on public.likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can unlike their own like" on public.likes;
create policy "users can unlike their own like" on public.likes
  for delete using (auth.uid() = user_id);

-- follows: anyone can see who follows whom (public follower lists).
-- Only the follower themself can create or remove the relationship.
drop policy if exists "read follows" on public.follows;
create policy "read follows" on public.follows
  for select using (true);

drop policy if exists "logged in users can follow" on public.follows;
create policy "logged in users can follow" on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "users can unfollow" on public.follows;
create policy "users can unfollow" on public.follows
  for delete using (auth.uid() = follower_id);

-- reports — no select policy at all => normal users can file a report
-- but can never read the moderation queue back.
drop policy if exists "logged in users can file a report" on public.reports;
create policy "logged in users can file a report" on public.reports
  for insert with check (auth.uid() = reporter_id);

-- ───────────────────────────────────────────────────────────────────
-- REALTIME — lets the frontend subscribe and have new posts/replies
-- "appear" live without a page refresh.
-- ───────────────────────────────────────────────────────────────────

do $$
begin
  alter publication supabase_realtime add table public.posts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.replies;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.follows;
exception when duplicate_object then null;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- STORAGE — one bucket for post/reply media, one for profile pictures.
-- Size/type limits are enforced server-side (not just in frontend JS).
-- ───────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true,
  5242880, -- 5 MB
  array['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true,
  2097152, -- 2 MB
  array['image/jpeg','image/png','image/gif','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read media" on storage.objects;
create policy "public read media" on storage.objects
  for select using (bucket_id in ('media','avatars'));

-- Post/reply media: any logged-in user can upload.
drop policy if exists "anyone can upload media" on storage.objects;
drop policy if exists "logged in users can upload media" on storage.objects;
create policy "logged in users can upload media" on storage.objects
  for insert with check (bucket_id = 'media' and auth.role() = 'authenticated');

-- Avatars: uploads must live under a folder named after the uploader's
-- own user id (avatars/<uid>/filename.ext) — enforced here so nobody
-- can overwrite someone else's avatar file. js/auth.js uploads to
-- that path automatically.
drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "users can replace their own avatar" on storage.objects;
create policy "users can replace their own avatar" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- No update/delete policy for anon on the 'media' bucket, and no
-- delete policy at all on 'avatars' — removal stays reserved for the
-- service_role key (dashboard / a moderator tool), same as table rows.

-- ═══════════════════════════════════════════════════════════════════
-- SEARCH / BOOKMARKS / NOTIFICATIONS / DMs
-- Added for: search.html, bookmarks.html, notifications.html, chat.html
-- Safe to re-run, same as the rest of this file.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- SEARCH — a trigram index makes ILIKE '%term%' fast on real data
-- volumes instead of a full sequential scan.
-- ───────────────────────────────────────────────────────────────────
create extension if not exists pg_trgm;
create index if not exists posts_body_trgm_idx on public.posts using gin (body gin_trgm_ops);
create index if not exists profiles_username_trgm_idx on public.profiles using gin (username gin_trgm_ops);
create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);

-- ───────────────────────────────────────────────────────────────────
-- BOOKMARKS — private to the user who saved them (unlike likes,
-- which are public). One row per (user, post).
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);
create index if not exists bookmarks_user_id_idx on public.bookmarks (user_id, created_at desc);

alter table public.bookmarks enable row level security;

drop policy if exists "users can read own bookmarks" on public.bookmarks;
create policy "users can read own bookmarks" on public.bookmarks
  for select using (auth.uid() = user_id);

drop policy if exists "users can bookmark" on public.bookmarks;
create policy "users can bookmark" on public.bookmarks
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can remove own bookmark" on public.bookmarks;
create policy "users can remove own bookmark" on public.bookmarks
  for delete using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────
-- NOTIFICATIONS — one row per like/reply/follow a user receives.
-- Rows are only ever created by the security-definer trigger
-- functions below (there is deliberately no insert policy for
-- anon/authenticated), so a user can never forge a notification.
-- Recipients can read and mark-as-read their own rows only.
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade, -- recipient
  actor_id   uuid not null references public.profiles(id) on delete cascade, -- who triggered it
  type       text not null check (type in ('like','reply','follow')),
  post_id    uuid references public.posts(id) on delete cascade,
  reply_id   uuid references public.replies(id) on delete cascade,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_id_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read = false;

alter table public.notifications enable row level security;

drop policy if exists "users can read own notifications" on public.notifications;
create policy "users can read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "users can mark own notifications read" on public.notifications;
create policy "users can mark own notifications read" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Extend the existing like/reply/follow trigger functions to also
-- drop a notification for the recipient (never for yourself).

create or replace function public.on_like_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  update public.posts set like_count = like_count + 1 where id = new.post_id returning author_id into recipient;
  if recipient is not null and recipient <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (recipient, new.user_id, 'like', new.post_id);
  end if;
  return new;
end; $$;

create or replace function public.on_reply_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  update public.posts set reply_count = reply_count + 1 where id = new.post_id;
  if new.parent_reply_id is not null then
    select author_id into recipient from public.replies where id = new.parent_reply_id;
  else
    select author_id into recipient from public.posts where id = new.post_id;
  end if;
  if recipient is not null and recipient <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, post_id, reply_id)
    values (recipient, new.author_id, 'reply', new.post_id, new.id);
  end if;
  return new;
end; $$;

create or replace function public.on_follow_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set following_count = following_count + 1 where id = new.follower_id;
  update public.profiles set followers_count = followers_count + 1 where id = new.followee_id;
  insert into public.notifications (user_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');
  return new;
end; $$;

-- ───────────────────────────────────────────────────────────────────
-- DIRECT MESSAGES — a flat message log between two users. A
-- "conversation" is just every row where you're the sender or the
-- recipient, grouped client-side by the other participant.
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  read         boolean not null default false,
  created_at   timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "participants can read their messages" on public.messages;
create policy "participants can read their messages" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "logged in users can send messages" on public.messages;
create policy "logged in users can send messages" on public.messages
  for insert with check (auth.uid() = sender_id);

drop policy if exists "recipient can mark messages read" on public.messages;
create policy "recipient can mark messages read" on public.messages
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/communities.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Communities (Twitter-Communities-style groups)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql has already been run at least once).
-- Safe to re-run — IF NOT EXISTS / OR REPLACE / drop-then-create,
-- same style as the rest of schema.sql.
--
-- Design:
--   • public.communities — one row per community. created_by is who
--     made it; they're auto-joined as its first member (see trigger
--     below), same as creating a Twitter Community makes you its
--     first member automatically.
--   • public.community_members — join table, one row per (community,
--     user). A row existing for a given pair IS the "joined" state —
--     there's no separate boolean anywhere to fall out of sync.
--   • posts gain a nullable community_id. A post with it set belongs
--     to that community's feed; null means it's a normal board post.
--     Every existing feed/profile/search query keeps working
--     unchanged — only the community page filters by it.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.communities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 3 and 50),
  slug         text not null unique check (slug ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(slug) between 3 and 50),
  description  text check (description is null or char_length(description) <= 300),
  created_by   uuid not null references public.profiles(id) on delete cascade,
  member_count integer not null default 0,
  post_count   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists communities_created_at_idx on public.communities (created_at desc);
create index if not exists communities_member_count_idx on public.communities (member_count desc);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members (user_id);

alter table public.posts add column if not exists community_id uuid references public.communities(id) on delete cascade;
create index if not exists posts_community_id_idx on public.posts (community_id, created_at desc);

-- Tightens schema.sql's original "logged in users can post" policy:
-- still just auth.uid() = author_id for a normal (non-community) post,
-- but a post with community_id set additionally requires the poster
-- to already be a member of that community — belt-and-suspenders
-- alongside community.js only showing the composer to members in the
-- first place.
drop policy if exists "logged in users can post" on public.posts;
create policy "logged in users can post" on public.posts
  for insert with check (
    auth.uid() = author_id
    and (
      community_id is null
      or exists (
        select 1 from public.community_members m
        where m.community_id = posts.community_id and m.user_id = auth.uid()
      )
    )
  );

-- ───────────────────────────────────────────────────────────────────
-- TRIGGERS
-- ───────────────────────────────────────────────────────────────────

-- Auto-join the creator as a member the instant a community is made —
-- security definer, since the plain "logged in users can join" policy
-- below would otherwise race this same request (the community row
-- doesn't exist for the client to reference until this insert returns).
create or replace function public.on_community_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.community_members (community_id, user_id) values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists trg_community_insert on public.communities;
create trigger trg_community_insert after insert on public.communities
for each row execute function public.on_community_insert();

-- Keep communities.member_count in sync with community_members rows.
create or replace function public.on_community_member_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.communities set member_count = member_count + 1 where id = new.community_id;
  return new;
end; $$;
drop trigger if exists trg_community_member_insert on public.community_members;
create trigger trg_community_member_insert after insert on public.community_members
for each row execute function public.on_community_member_insert();

create or replace function public.on_community_member_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
  return old;
end; $$;
drop trigger if exists trg_community_member_delete on public.community_members;
create trigger trg_community_member_delete after delete on public.community_members
for each row execute function public.on_community_member_delete();

-- Keep communities.post_count in sync with posts.community_id.
create or replace function public.on_community_post_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.community_id is not null then
    update public.communities set post_count = post_count + 1 where id = new.community_id;
  end if;
  return new;
end; $$;
drop trigger if exists trg_community_post_insert on public.posts;
create trigger trg_community_post_insert after insert on public.posts
for each row execute function public.on_community_post_insert();

-- ───────────────────────────────────────────────────────────────────
-- RLS — reads are public (anyone can browse/discover communities and
-- their posts without an account, same as the rest of the board).
-- Creating a community, joining, and leaving all require being
-- logged in and acting only on your own membership row.
-- ───────────────────────────────────────────────────────────────────

alter table public.communities       enable row level security;
alter table public.community_members enable row level security;

drop policy if exists "communities are publicly readable" on public.communities;
create policy "communities are publicly readable" on public.communities
  for select using (true);

drop policy if exists "logged in users can create a community" on public.communities;
create policy "logged in users can create a community" on public.communities
  for insert with check (auth.uid() = created_by);

drop policy if exists "read community membership" on public.community_members;
create policy "read community membership" on public.community_members
  for select using (true);

drop policy if exists "logged in users can join a community" on public.community_members;
create policy "logged in users can join a community" on public.community_members
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can leave a community" on public.community_members;
create policy "users can leave a community" on public.community_members
  for delete using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────
-- REALTIME
-- ───────────────────────────────────────────────────────────────────

do $$
begin
  alter publication supabase_realtime add table public.communities;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.community_members;
exception when duplicate_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/quotes_and_reposts.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Quote posts + Reposts
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql has already been run at least once).
-- Safe to re-run — uses IF NOT EXISTS / OR REPLACE / drop-then-create
-- throughout, same style as the rest of schema.sql.
--
-- Design:
--   • A "quote" is just a normal row in public.posts that happens to
--     have quote_of set to the post it's quoting. That means quote
--     posts show up in every feed/profile/search query you already
--     have for free — no new query paths needed for them.
--   • A "repost" (plain retweet, no comment) is NOT a new posts row —
--     it's a row in the new public.reposts table, one per
--     (user, post). That's what makes it toggleable/undoable and
--     keeps it from cluttering the posts table or reply counts.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- QUOTE POSTS
-- ───────────────────────────────────────────────────────────────────
alter table public.posts add column if not exists quote_of uuid references public.posts(id) on delete set null;
create index if not exists posts_quote_of_idx on public.posts (quote_of);

-- ───────────────────────────────────────────────────────────────────
-- REPOSTS
-- ───────────────────────────────────────────────────────────────────
alter table public.posts add column if not exists repost_count integer not null default 0;

create table if not exists public.reposts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);
create index if not exists reposts_post_id_idx on public.reposts (post_id);
create index if not exists reposts_user_id_idx on public.reposts (user_id, created_at desc);

alter table public.reposts enable row level security;

drop policy if exists "read reposts" on public.reposts;
create policy "read reposts" on public.reposts
  for select using (true);

drop policy if exists "logged in users can repost" on public.reposts;
create policy "logged in users can repost" on public.reposts
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can undo their own repost" on public.reposts;
create policy "users can undo their own repost" on public.reposts
  for delete using (auth.uid() = user_id);

-- keep posts.repost_count in sync, and notify the original author
-- (never yourself) that someone reposted them.
create or replace function public.on_repost_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  update public.posts set repost_count = repost_count + 1 where id = new.post_id returning author_id into recipient;
  if recipient is not null and recipient <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (recipient, new.user_id, 'repost', new.post_id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_repost_insert on public.reposts;
create trigger trg_repost_insert after insert on public.reposts
for each row execute function public.on_repost_insert();

create or replace function public.on_repost_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.posts set repost_count = greatest(repost_count - 1, 0) where id = old.post_id;
  return old;
end; $$;

drop trigger if exists trg_repost_delete on public.reposts;
create trigger trg_repost_delete after delete on public.reposts
for each row execute function public.on_repost_delete();

-- notify the quoted post's author when someone quotes it. Quote posts
-- are plain rows in public.posts (see above), so this hooks the
-- posts INSERT trigger rather than the reposts table.
create or replace function public.on_post_insert_notify_quote() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  if new.quote_of is not null then
    select author_id into recipient from public.posts where id = new.quote_of;
    if recipient is not null and recipient <> new.author_id then
      insert into public.notifications (user_id, actor_id, type, post_id)
      values (recipient, new.author_id, 'quote', new.id);
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_post_insert_notify_quote on public.posts;
create trigger trg_post_insert_notify_quote after insert on public.posts
for each row execute function public.on_post_insert_notify_quote();

-- ───────────────────────────────────────────────────────────────────
-- QUOTE VIEW CASCADING — a view on a quote post counts as a view of
-- the post it's quoting too (and that post's quote, if it's itself a
-- quote, and so on up the chain), same way a quote-retweet's
-- impressions roll up to the original tweet on Twitter. Only views
-- cascade this way — likes/replies/reposts stay tied to whichever
-- exact post row they were made on. Replaces the schema.sql version
-- of this function (same signature, same grants).
-- ───────────────────────────────────────────────────────────────────
create or replace function public.increment_post_view(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur_id uuid := p_id;
  parent_id uuid;
  hops int := 0;
begin
  loop
    update public.posts set view_count = view_count + 1 where id = cur_id and is_deleted = false;
    select quote_of into parent_id from public.posts where id = cur_id;
    exit when parent_id is null or hops >= 20; -- 20 is just a sanity cap against a corrupted/cyclical chain
    cur_id := parent_id;
    hops := hops + 1;
  end loop;
end; $$;

grant execute on function public.increment_post_view(uuid) to anon, authenticated;

-- widen the notifications type check (originally 'like'/'reply'/'follow' only).
-- 'mention' is included too (not added by this file) so that re-running
-- this script after mentions.sql has already run doesn't fail with
-- "check constraint is violated by some row" against existing mention rows.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','reply','follow','repost','quote','mention'));

do $$
begin
  alter publication supabase_realtime add table public.reposts;
exception when duplicate_object then null;
end $$;

-- Tell PostgREST (the API layer Supabase's JS client talks to) to
-- immediately pick up the new table/columns instead of waiting for
-- its own periodic schema-cache refresh. Harmless if your project's
-- PostgREST doesn't listen for this — it's a no-op notify either way.
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/settings.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Settings & notification preferences
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- Run this AFTER supabase/schema.sql. Safe to re-run (IF NOT EXISTS /
-- OR REPLACE / ON CONFLICT throughout, same pattern as schema.sql).
--
-- Adds the real "options" behind settings.html:
--   - a banner/cover photo on profiles (Twitter-style)
--   - per-user notification toggles (likes / replies / follows)
--   - a "who can message you" privacy setting, actually enforced by
--     the messages table's RLS policy, not just hidden in the UI
-- ═══════════════════════════════════════════════════════════════════

-- Profile banner (cover photo) shown behind the avatar on profile.html
-- and editprofile.html. Uploaded to the existing 'avatars' bucket —
-- same own-folder storage policy as the avatar already covers it, so
-- no bucket/policy changes are needed for this.
alter table public.profiles add column if not exists banner_url text;

-- ───────────────────────────────────────────────────────────────────
-- USER SETTINGS — one row per user. Created automatically the moment
-- a profile is created (trigger below), so the client never has to
-- special-case a "missing settings row."
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  notify_likes    boolean not null default true,
  notify_replies  boolean not null default true,
  notify_follows  boolean not null default true,
  dm_privacy      text not null default 'everyone' check (dm_privacy in ('everyone','following')),
  created_at      timestamptz not null default now()
);

-- Backfill for any accounts that existed before this table did.
insert into public.user_settings (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_new_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

alter table public.user_settings enable row level security;

drop policy if exists "users can read own settings" on public.user_settings;
create policy "users can read own settings" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "users can update own settings" on public.user_settings;
create policy "users can update own settings" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deliberately no insert policy for anon/authenticated — rows are
-- only ever created by the trigger above (security definer), same
-- pattern the notifications table already uses.

-- ───────────────────────────────────────────────────────────────────
-- Wire the notification toggles into the existing like/reply/follow
-- trigger functions from schema.sql — same triggers, just gated by
-- the recipient's saved preference before writing a notifications row.
-- ───────────────────────────────────────────────────────────────────
create or replace function public.on_like_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid; wants boolean;
begin
  update public.posts set like_count = like_count + 1 where id = new.post_id returning author_id into recipient;
  if recipient is not null and recipient <> new.user_id then
    select notify_likes into wants from public.user_settings where user_id = recipient;
    if coalesce(wants, true) then
      insert into public.notifications (user_id, actor_id, type, post_id)
      values (recipient, new.user_id, 'like', new.post_id);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.on_reply_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid; wants boolean;
begin
  update public.posts set reply_count = reply_count + 1 where id = new.post_id;
  if new.parent_reply_id is not null then
    select author_id into recipient from public.replies where id = new.parent_reply_id;
  else
    select author_id into recipient from public.posts where id = new.post_id;
  end if;
  if recipient is not null and recipient <> new.author_id then
    select notify_replies into wants from public.user_settings where user_id = recipient;
    if coalesce(wants, true) then
      insert into public.notifications (user_id, actor_id, type, post_id, reply_id)
      values (recipient, new.author_id, 'reply', new.post_id, new.id);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.on_follow_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare wants boolean;
begin
  update public.profiles set following_count = following_count + 1 where id = new.follower_id;
  update public.profiles set followers_count = followers_count + 1 where id = new.followee_id;
  select notify_follows into wants from public.user_settings where user_id = new.followee_id;
  if coalesce(wants, true) then
    insert into public.notifications (user_id, actor_id, type)
    values (new.followee_id, new.follower_id, 'follow');
  end if;
  return new;
end; $$;

-- ───────────────────────────────────────────────────────────────────
-- DM PRIVACY — "everyone" (default) or "following" (only people the
-- recipient already follows can message them — mirrors Twitter's
-- "message requests" setting). This is enforced here, at the database
-- level, not just hidden in the UI: it replaces the messages insert
-- policy from schema.sql with one that also checks the recipient's
-- saved preference.
-- ───────────────────────────────────────────────────────────────────
drop policy if exists "logged in users can send messages" on public.messages;
create policy "logged in users can send messages" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and (
      not exists (
        select 1 from public.user_settings
        where user_id = recipient_id and dm_privacy = 'following'
      )
      or exists (
        select 1 from public.follows
        where follower_id = recipient_id and followee_id = sender_id
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/bookmark_count.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Public bookmark count
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql has already been run at least once).
-- Safe to re-run, same pattern as the rest.
--
-- The bookmarks table itself stays exactly as private as before —
-- "users can read own bookmarks" in schema.sql still means only the
-- person who bookmarked a post can see that they did. This just adds
-- a plain aggregate counter on posts, the same way like_count/
-- reply_count/repost_count already work, so the post-detail page
-- (thread.html) can show a bookmark count next to the icon like the
-- rest of the action row — nobody's identity is exposed by it, only
-- a number.
-- ═══════════════════════════════════════════════════════════════════
alter table public.posts add column if not exists bookmark_count integer not null default 0;

-- Backfill for any bookmarks that were created before this column existed.
update public.posts p set bookmark_count = (
  select count(*) from public.bookmarks b where b.post_id = p.id
) where exists (select 1 from public.bookmarks b where b.post_id = p.id);

create or replace function public.on_bookmark_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.posts set bookmark_count = bookmark_count + 1 where id = new.post_id;
  return new;
end; $$;

drop trigger if exists trg_bookmark_insert on public.bookmarks;
create trigger trg_bookmark_insert after insert on public.bookmarks
for each row execute function public.on_bookmark_insert();

create or replace function public.on_bookmark_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.posts set bookmark_count = greatest(bookmark_count - 1, 0) where id = old.post_id;
  return old;
end; $$;

drop trigger if exists trg_bookmark_delete on public.bookmarks;
create trigger trg_bookmark_delete after delete on public.bookmarks
for each row execute function public.on_bookmark_delete();

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/lists.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Lists (Twitter-Lists-style curated groups of people)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql has already been run at least once).
-- Safe to re-run — IF NOT EXISTS / OR REPLACE / drop-then-create,
-- same style as the rest of schema.sql / communities.sql.
--
-- Design (mirrors communities.sql):
--   • public.lists — one row per list. owner_id is who made it.
--     is_private mirrors Twitter's Private/Public list choice: a
--     private list (and its membership) is only ever visible to its
--     owner; a public list is visible to everyone, same as the rest
--     of the board.
--   • public.list_members — join table, one row per (list, profile
--     added to it). A row existing for a given pair IS the "on this
--     list" state — no separate boolean to fall out of sync, and
--     the member being added never needs to consent (same as real
--     Twitter Lists — only the owner can add/remove).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.lists (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 50),
  description  text check (description is null or char_length(description) <= 200),
  is_private   boolean not null default false,
  member_count integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists lists_owner_idx on public.lists (owner_id, created_at desc);

create table if not exists public.list_members (
  list_id    uuid not null references public.lists(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (list_id, member_id)
);
create index if not exists list_members_member_idx on public.list_members (member_id);
create index if not exists list_members_list_idx on public.list_members (list_id, added_at desc);

-- ───────────────────────────────────────────────────────────────────
-- TRIGGERS — keep lists.member_count in sync with list_members rows,
-- same pattern as communities.sql's member_count triggers.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.on_list_member_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.lists set member_count = member_count + 1 where id = new.list_id;
  return new;
end; $$;
drop trigger if exists trg_list_member_insert on public.list_members;
create trigger trg_list_member_insert after insert on public.list_members
for each row execute function public.on_list_member_insert();

create or replace function public.on_list_member_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.lists set member_count = greatest(member_count - 1, 0) where id = old.list_id;
  return old;
end; $$;
drop trigger if exists trg_list_member_delete on public.list_members;
create trigger trg_list_member_delete after delete on public.list_members
for each row execute function public.on_list_member_delete();

-- ───────────────────────────────────────────────────────────────────
-- RLS — a public list (and its membership) is readable by anyone,
-- same as a community. A private list is readable only by its owner
-- — including its membership rows, so being added to someone's
-- private list never leaks that list's existence to anyone else.
-- Only the owner can create/rename/delete a list or add/remove who's
-- on it; the person being added has no say, matching real Twitter
-- Lists (and the same trust model communities.sql uses for who can
-- change a community's own picture).
-- ───────────────────────────────────────────────────────────────────

alter table public.lists        enable row level security;
alter table public.list_members enable row level security;

drop policy if exists "public lists are readable by anyone, private ones by their owner" on public.lists;
create policy "public lists are readable by anyone, private ones by their owner" on public.lists
  for select using (is_private = false or owner_id = auth.uid());

drop policy if exists "logged in users can create a list" on public.lists;
create policy "logged in users can create a list" on public.lists
  for insert with check (auth.uid() = owner_id);

drop policy if exists "owner can update their own list" on public.lists;
create policy "owner can update their own list" on public.lists
  for update using (auth.uid() = owner_id);

drop policy if exists "owner can delete their own list" on public.lists;
create policy "owner can delete their own list" on public.lists
  for delete using (auth.uid() = owner_id);

drop policy if exists "read list membership of a visible list" on public.list_members;
create policy "read list membership of a visible list" on public.list_members
  for select using (
    exists (
      select 1 from public.lists l
      where l.id = list_members.list_id and (l.is_private = false or l.owner_id = auth.uid())
    )
  );

drop policy if exists "owner can add someone to their own list" on public.list_members;
create policy "owner can add someone to their own list" on public.list_members
  for insert with check (
    exists (select 1 from public.lists l where l.id = list_members.list_id and l.owner_id = auth.uid())
  );

drop policy if exists "owner can remove someone from their own list" on public.list_members;
create policy "owner can remove someone from their own list" on public.list_members
  for delete using (
    exists (select 1 from public.lists l where l.id = list_members.list_id and l.owner_id = auth.uid())
  );

-- ───────────────────────────────────────────────────────────────────
-- REALTIME
-- ───────────────────────────────────────────────────────────────────

do $$
begin
  alter publication supabase_realtime add table public.lists;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.list_members;
exception when duplicate_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/profile_extras.sql
-- ═══════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────
-- PROFILE EXTRAS — location + website on profiles (edit profile
-- page), a pinned post per profile, and Mute/Block relationships +
-- user-level reports for the profile "···" menu. Run after schema.sql.
-- ─────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists location text check (location is null or char_length(location) <= 30),
  add column if not exists website  text check (website  is null or char_length(website)  <= 100),
  add column if not exists pinned_post_id uuid references public.posts(id) on delete set null;

-- MUTES — muting hides someone's posts from your own feeds without
-- unfollowing/blocking them or letting them know, same as Twitter.
create table if not exists public.mutes (
  muter_id   uuid not null references public.profiles(id) on delete cascade,
  muted_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_not_self check (muter_id <> muted_id)
);
create index if not exists mutes_muter_idx on public.mutes (muter_id);

alter table public.mutes enable row level security;

drop policy if exists "read own mutes" on public.mutes;
create policy "read own mutes" on public.mutes
  for select using (auth.uid() = muter_id);

drop policy if exists "create own mutes" on public.mutes;
create policy "create own mutes" on public.mutes
  for insert with check (auth.uid() = muter_id);

drop policy if exists "delete own mutes" on public.mutes;
create policy "delete own mutes" on public.mutes
  for delete using (auth.uid() = muter_id);

-- BLOCKS — a public (like follows) blocker → blocked relationship,
-- so a blocked profile's "Follow" state can reflect it either way.
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocker_idx on public.blocks (blocker_id);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

drop policy if exists "read blocks" on public.blocks;
create policy "read blocks" on public.blocks
  for select using (true);

drop policy if exists "create own blocks" on public.blocks;
create policy "create own blocks" on public.blocks
  for insert with check (auth.uid() = blocker_id);

drop policy if exists "delete own blocks" on public.blocks;
create policy "delete own blocks" on public.blocks
  for delete using (auth.uid() = blocker_id);

-- Blocking someone also unwinds any existing follow either direction,
-- same as Twitter (you can't stay "following" someone you just blocked
-- or who blocked you).
create or replace function public.handle_new_block()
returns trigger language plpgsql security definer as $$
begin
  delete from public.follows
    where (follower_id = new.blocker_id and followee_id = new.blocked_id)
       or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end; $$;

drop trigger if exists trg_block_insert on public.blocks;
create trigger trg_block_insert after insert on public.blocks
  for each row execute function public.handle_new_block();

-- Reports: allow reporting a profile directly (not just a post/reply).
alter table public.reports
  add column if not exists reported_user_id uuid references public.profiles(id) on delete cascade;

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/communities_search.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Communities search
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql and communities.sql have both already been run).
-- Safe to re-run — IF NOT EXISTS throughout, same style as the rest
-- of the project's SQL files.
--
-- communities.js's ilike('%term%') filter on the "All" tab works
-- without this, it's just a full sequential scan of public.communities
-- until then. Same reasoning as the posts_body_trgm_idx /
-- profiles_username_trgm_idx indexes in schema.sql — this just
-- extends that same trigram-index treatment to name/description.
-- pg_trgm itself is already enabled by schema.sql, so this only adds
-- the two new indexes.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

create index if not exists communities_name_trgm_idx
  on public.communities using gin (name gin_trgm_ops);

create index if not exists communities_description_trgm_idx
  on public.communities using gin (description gin_trgm_ops);

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/community_creator_and_post_limit.sql
-- ═══════════════════════════════════════════════════════════════════
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
--      500 characters. Replies/comments are untouched — still 4000 —
--      since only posts were asked to shrink.
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

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/mentions.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — @Mentions (user tagging)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql, settings.sql, and quotes_and_reposts.sql have
-- already been run — settings.sql specifically, since this adds a
-- column to user_settings). Safe to re-run, same pattern as the rest.
--
-- Tagging someone with @username in a post or reply body doesn't need
-- a schema change to the post itself — the client just renders any
-- @handle in the body as a link (see renderBody()/linkifyText() in
-- js/common.js). What this file adds is the notification side: when
-- a post/reply is inserted, a trigger scans its body for @handles,
-- looks each one up, and drops a 'mention' notification for every
-- match (skipping yourself and respecting the recipient's toggle),
-- the same way schema.sql already does for likes/replies/follows.
-- ═══════════════════════════════════════════════════════════════════

-- widen the notifications type check (was 'like'/'reply'/'follow',
-- then 'repost'/'quote' from quotes_and_reposts.sql) to allow 'mention'
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','reply','follow','repost','quote','mention'));

-- per-user toggle, same pattern as notify_likes/notify_replies/notify_follows
alter table public.user_settings add column if not exists notify_mentions boolean not null default true;

-- Shared helper: given a post/reply body + who wrote it + which
-- post/reply it landed on, find every @username mentioned, look each
-- one up (case-insensitive, matching how profiles.username is already
-- indexed), and insert a 'mention' notification for each match —
-- never for yourself, never twice for the same user on the same body,
-- and only if that recipient hasn't turned mention notifications off.
create or replace function public.notify_mentions(p_body text, p_author_id uuid, p_post_id uuid, p_reply_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  handle text;
  recipient uuid;
  wants boolean;
begin
  for handle in
    select distinct lower((regexp_matches(p_body, '(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,20})', 'g'))[1])
  loop
    select id into recipient from public.profiles where lower(username) = handle;
    if recipient is not null and recipient <> p_author_id then
      select notify_mentions into wants from public.user_settings where user_id = recipient;
      if coalesce(wants, true) then
        insert into public.notifications (user_id, actor_id, type, post_id, reply_id)
        values (recipient, p_author_id, 'mention', p_post_id, p_reply_id);
      end if;
    end if;
  end loop;
end; $$;

create or replace function public.on_post_insert_notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_mentions(new.body, new.author_id, new.id, null);
  return new;
end; $$;

drop trigger if exists trg_post_insert_notify_mentions on public.posts;
create trigger trg_post_insert_notify_mentions after insert on public.posts
for each row execute function public.on_post_insert_notify_mentions();

create or replace function public.on_reply_insert_notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_mentions(new.body, new.author_id, new.post_id, new.id);
  return new;
end; $$;

drop trigger if exists trg_reply_insert_notify_mentions on public.replies;
create trigger trg_reply_insert_notify_mentions after insert on public.replies
for each row execute function public.on_reply_insert_notify_mentions();

-- Tell PostgREST to pick up the new column immediately instead of
-- waiting for its periodic schema-cache refresh.
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/gifs_polls_scheduling.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — GIFs, polls, and scheduled posts
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

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/schedule_max_4y.sql
-- ═══════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/pin_follow_marpe.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- PIN A MANDATORY FOLLOW OF @marpe
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run.
--
-- What this does:
--   1. Every new signup automatically gets a follows row pointing at
--      @marpe, in the same transaction that creates their profile.
--   2. Existing users are backfilled once (everyone who doesn't
--      already follow @marpe gets the row added).
--   3. The RLS policy that lets people unfollow is tightened so a
--      follow row targeting @marpe can never be deleted by its
--      follower. This is the actual guardrail — the UI also disables
--      the button (js/profile.js, js/followlist.js), but that's just
--      UX; someone hitting the API directly is stopped here.
--
-- NOTE: this assumes a profile with username = 'marpe' already
-- exists. If that username ever changes, update the lower('marpe')
-- literals below (in both the function and the policy) to match.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. extend the existing signup trigger to auto-follow @marpe ──
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  marpe_id uuid;
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    new.raw_user_meta_data->>'avatar_url'
  );

  select id into marpe_id from public.profiles where lower(username) = 'marpe';
  if marpe_id is not null and marpe_id <> new.id then
    insert into public.follows (follower_id, followee_id)
    values (new.id, marpe_id)
    on conflict do nothing;
  end if;

  return new;
end; $$;

-- (trigger itself is unchanged — it already points at this function —
-- but re-declared here so this file works standalone too)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. one-time backfill for accounts created before this ran ──
insert into public.follows (follower_id, followee_id)
select p.id, m.id
from public.profiles p
cross join (select id from public.profiles where lower(username) = 'marpe') m
where p.id <> m.id
on conflict do nothing;

-- ── 3. RLS: block deleting a follow row whose followee is @marpe ──
drop policy if exists "users can unfollow" on public.follows;
create policy "users can unfollow" on public.follows
  for delete using (
    auth.uid() = follower_id
    and followee_id <> (select id from public.profiles where lower(username) = 'marpe')
  );

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/fix_delete_policy.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Fix: "new row violates row-level security policy for
-- table posts" when deleting your own post.
--
-- Run this ENTIRE file, BY ITSELF, in a fresh Supabase SQL Editor
-- query (don't paste it into the middle of a bigger script — see
-- the note at the bottom on why that matters). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ── STEP 1: what does the database actually have right now? ──
-- Run this block first and look at the output before going further.
-- You're looking for a row where policyname = 'users can edit own
-- posts' and cmd = 'UPDATE'. If that row is missing, the policy
-- never actually got created/committed on this project — which is
-- the #1 cause of this exact error.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'posts'
order by cmd, policyname;

-- ── STEP 2: force RLS on and rebuild every posts policy from a known
-- good state. This doesn't change behavior if everything was already
-- correct — it just guarantees it, regardless of what step 1 showed. ──
alter table public.posts enable row level security;

drop policy if exists "read non-deleted posts" on public.posts;
create policy "read non-deleted posts" on public.posts
  for select using (
    is_deleted = false
    and (scheduled_at is null or scheduled_at <= now() or author_id = auth.uid())
  );

drop policy if exists "logged in users can post" on public.posts;
create policy "logged in users can post" on public.posts
  for insert with check (auth.uid() = author_id);

drop policy if exists "users can edit own posts" on public.posts;
create policy "users can edit own posts" on public.posts
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- ── STEP 3: confirm it took. Should now show 3 rows: SELECT, INSERT,
-- UPDATE, each scoped the way you'd expect. ──
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'posts'
order by cmd, policyname;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- Why this keeps happening: Supabase's SQL Editor runs a pasted
-- multi-statement script as ONE implicit transaction. If any single
-- statement anywhere in a big script errors, Postgres rolls back the
-- WHOLE batch — including policies defined earlier in that same
-- paste that looked like they ran fine. Running this short file on
-- its own, isolated, removes that risk entirely.
--
-- If step 3 shows the right 3 rows and deleting still fails, the
-- next most likely cause isn't the policy at all — it's that the
-- browser session is stale (signed in a while ago, token expired).
-- Sign out, sign back in, and try the delete again before re-running
-- this file.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/fix_delete_policy_replies.sql
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Fix: can't delete your own replies/comments (RLS
-- policy for UPDATE on public.replies missing or never committed).
--
-- This is the same class of issue fix_delete_policy.sql fixes for
-- public.posts, just for public.replies. Run this ENTIRE file, BY
-- ITSELF, in a fresh Supabase SQL Editor query. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ── STEP 1: what does the database actually have right now? ──
-- You're looking for a row where policyname = 'users can edit own
-- replies' and cmd = 'UPDATE'. If it's missing, that's why deletes
-- fail — the frontend does a soft-delete UPDATE (is_deleted = true),
-- and with no UPDATE policy, RLS blocks it by default.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'replies'
order by cmd, policyname;

-- ── STEP 2: force RLS on and rebuild every replies policy from a
-- known good state. ──
alter table public.replies enable row level security;

drop policy if exists "read non-deleted replies" on public.replies;
create policy "read non-deleted replies" on public.replies
  for select using (is_deleted = false);

drop policy if exists "logged in users can reply" on public.replies;
create policy "logged in users can reply" on public.replies
  for insert with check (auth.uid() = author_id);

drop policy if exists "users can edit own replies" on public.replies;
create policy "users can edit own replies" on public.replies
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- ── STEP 3: confirm it took. Should now show 3 rows: SELECT, INSERT,
-- UPDATE. ──
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'replies'
order by cmd, policyname;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- Note: the missing UPDATE policy was only half the bug. The other
-- half was in the frontend — the Delete button was never even being
-- rendered for your own replies/comments (it hard-coded "no delete
-- on replies", and where it did try, it pointed at the wrong table).
-- That's fixed in this same update: js/common.js, js/thread.js,
-- js/profile.js.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- FROM: supabase/fix_delete_via_rpc.sql
-- ═══════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════
-- FINAL, GUARANTEED-LAST FIXES — these restate a couple of things
-- above on purpose, so their final state is correct no matter what
-- order anything ran in, and add the For You ranking function last,
-- defensively, so it can never fail from a missing dependency again.
-- ═══════════════════════════════════════════════════════════════════

-- Scheduled posts: restate the column + policy one final time.
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

-- FOR YOU FEED ALGORITHM — defensive: add the columns it needs right
-- here, right before creating it, so this block can never fail with
-- "column does not exist" regardless of what ran (or didn't) above.
alter table public.posts add column if not exists repost_count integer not null default 0;
alter table public.posts add column if not exists bookmark_count integer not null default 0;

-- Twitter-style ranking: weighted engagement signals + recency decay
-- + follow boost + block/mute filtering + per-author diversity decay
-- (so one prolific author's posts can't fill the whole feed).
create or replace function public.get_for_you_feed(
  viewer   uuid default null,
  limit_n  integer default 50,
  offset_n integer default 0
)
returns setof public.posts
language sql
stable
as $$
  with v as (
    select coalesce(viewer, auth.uid()) as id
  ),
  -- Candidate pool: published, non-deleted posts, with anyone the
  -- viewer has blocked/been blocked by/muted removed up front. This
  -- runs even for logged-out viewers (v.id is null), where it's a
  -- no-op — every post stays eligible.
  eligible as (
    select p.id, p.author_id, p.like_count, p.reply_count, p.repost_count,
           p.bookmark_count, p.view_count, p.created_at
    from public.posts p, v
    where p.is_deleted = false
      and (p.scheduled_at is null or p.scheduled_at <= now())
      and (
        v.id is null
        or p.author_id not in (
          select blocked_id from public.blocks where blocker_id = v.id
          union
          select blocker_id from public.blocks where blocked_id = v.id
          union
          select muted_id  from public.mutes  where muter_id  = v.id
        )
      )
  ),
  -- Raw score: replies/reposts weigh more than likes (higher-effort
  -- signals), bookmarks next, views barely move the needle. Divided
  -- by an age-based gravity term so fresh posts don't get buried
  -- under old viral ones forever. Multiplied 3x if the viewer follows
  -- the author (in-network boost, same idea as Twitter's timeline mix).
  scored as (
    select
      e.id,
      e.author_id,
      (
        (e.like_count * 1.0 + e.reply_count * 2.5 + e.repost_count * 2.5
         + e.bookmark_count * 1.75 + e.view_count * 0.05 + 1)
        * (case
            when (select id from v) is not null and exists (
              select 1 from public.follows f
              where f.follower_id = (select id from v) and f.followee_id = e.author_id
            ) then 3.0
            else 1.0
          end)
        / power((extract(epoch from (now() - e.created_at)) / 3600.0) + 2, 1.8)
      ) as raw_score
    from eligible e
  ),
  -- Author diversity: rank each author's own posts by score, then
  -- discount the 2nd/3rd/4th... best post from the same author more
  -- and more, so a single account's posting streak can't dominate
  -- the top of the feed even if every post scores well.
  ranked as (
    select
      id,
      author_id,
      raw_score,
      row_number() over (partition by author_id order by raw_score desc) as author_rank
    from scored
  )
  select p.*
  from ranked r
  join public.posts p on p.id = r.id
  order by (r.raw_score / power(r.author_rank, 1.3)) desc, p.created_at desc
  limit limit_n
  offset offset_n;
$$;

notify pgrst, 'reload schema';

-- Sanity check — should return one row confirming the function
-- exists with the right argument names/types. If this errors, the
-- function creation above genuinely failed — scroll up in the SQL
-- Editor's output for the real error message right above this point.
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'get_for_you_feed';
