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
