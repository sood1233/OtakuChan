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
