-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Communities (Twitter-Communities-style groups)
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
