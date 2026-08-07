-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Supabase schema (accounts edition)
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
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.replies (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 4000),
  media_url    text,
  media_type   text check (media_type is null or media_type in ('image','video')),
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.likes (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (post_id, user_id)
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
create index if not exists reports_resolved_idx    on public.reports (resolved);

-- ───────────────────────────────────────────────────────────────────
-- TRIGGERS — keep denormalized counters in sync
-- ───────────────────────────────────────────────────────────────────

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
  for select using (is_deleted = false);

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

-- reports — no select policy at all => normal users can file a report
-- but can never read the moderation queue back.
drop policy if exists "logged in users can file a report" on public.reports;
create policy "logged in users can file a report" on public.reports
  for insert with check (auth.uid() = reporter_id);

-- ───────────────────────────────────────────────────────────────────
-- REALTIME — lets the frontend subscribe and have new posts/replies
-- "appear" live without a page refresh.
-- ───────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.replies;

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
