-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Supabase schema
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout).
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────
-- TABLES
-- ───────────────────────────────────────────────────────────────────

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  author       text not null default 'Anonymous' check (char_length(author) <= 50),
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
  author       text not null default 'Anonymous' check (char_length(author) <= 50),
  body         text not null check (char_length(body) between 1 and 4000),
  media_url    text,
  media_type   text check (media_type is null or media_type in ('image','video')),
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.likes (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  ip_hash      text not null,               -- per-browser device id (see js/common.js)
  created_at   timestamptz not null default now(),
  unique (post_id, ip_hash)
);

-- Reports feed a private moderation queue. Anon can insert but never read.
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid references public.posts(id) on delete cascade,
  reply_id     uuid references public.replies(id) on delete cascade,
  reason       text not null check (reason in ('illegal','spam','doxxing','harassment','other')),
  details      text check (details is null or char_length(details) <= 500),
  created_at   timestamptz not null default now(),
  resolved     boolean not null default false
);

create index if not exists posts_created_at_idx   on public.posts (created_at desc);
create index if not exists replies_post_id_idx    on public.replies (post_id);
create index if not exists likes_post_id_idx      on public.likes (post_id);
create index if not exists reports_resolved_idx   on public.reports (resolved);

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
-- Anonymous (anon) key can: read non-deleted rows, create posts/replies/
-- likes/reports. It can NEVER update or delete — that's reserved for
-- the service_role key, which you'd use from a moderator-only tool or
-- the Supabase dashboard's table editor.
-- ───────────────────────────────────────────────────────────────────

alter table public.posts   enable row level security;
alter table public.replies enable row level security;
alter table public.likes   enable row level security;
alter table public.reports enable row level security;

drop policy if exists "read non-deleted posts" on public.posts;
create policy "read non-deleted posts" on public.posts
  for select using (is_deleted = false);

drop policy if exists "anyone can create a post" on public.posts;
create policy "anyone can create a post" on public.posts
  for insert with check (true);

drop policy if exists "read non-deleted replies" on public.replies;
create policy "read non-deleted replies" on public.replies
  for select using (is_deleted = false);

drop policy if exists "anyone can create a reply" on public.replies;
create policy "anyone can create a reply" on public.replies
  for insert with check (true);

drop policy if exists "read likes" on public.likes;
create policy "read likes" on public.likes
  for select using (true);

drop policy if exists "anyone can like once" on public.likes;
create policy "anyone can like once" on public.likes
  for insert with check (true);

-- No select policy on reports at all => anon can insert but never read them back.
drop policy if exists "anyone can file a report" on public.reports;
create policy "anyone can file a report" on public.reports
  for insert with check (true);

-- ───────────────────────────────────────────────────────────────────
-- REALTIME — lets the frontend subscribe and have new posts/replies
-- "appear" live without a page refresh.
-- ───────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.replies;

-- ───────────────────────────────────────────────────────────────────
-- STORAGE — bucket for images & video, with size/type limits enforced
-- server-side (not just in the frontend JS).
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

drop policy if exists "public read media" on storage.objects;
create policy "public read media" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "anyone can upload media" on storage.objects;
create policy "anyone can upload media" on storage.objects
  for insert with check (bucket_id = 'media');

-- No update/delete storage policy for anon — files can only be removed
-- via the dashboard or service_role, same as rows above.
