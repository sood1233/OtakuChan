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
