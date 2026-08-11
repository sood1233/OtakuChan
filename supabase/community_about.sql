-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Community rules + moderators (About tab)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after communities.sql and community_creator_and_post_limit.sql have
-- already been run). Safe to re-run.
--
-- What this does:
--   • public.community_rules — numbered rules a community's creator
--     sets during (or after) creation, each a short title + optional
--     description. Shown on the community's About tab, same idea as
--     an X Community's rule list.
--   • public.community_moderators — extra members the creator has
--     hand-picked as moderators, shown on the About tab under the
--     creator. This is a trust/display role only — it does not on its
--     own grant delete/edit powers; the creator (communities.created_by)
--     already has those via community_creator_and_post_limit.sql.
--   • Only the community's own creator can add/remove rules or
--     moderators — enforced by RLS, mirroring "creator can update own
--     community". Everyone (including logged-out visitors) can read
--     both, same as the rest of a community's public info.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.community_rules (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  position     integer not null default 0,
  title        text not null check (char_length(title) between 1 and 100),
  description  text check (description is null or char_length(description) <= 300),
  created_at   timestamptz not null default now()
);
create index if not exists community_rules_community_idx on public.community_rules (community_id, position);

create table if not exists public.community_moderators (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  added_by     uuid not null references public.profiles(id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_moderators_user_idx on public.community_moderators (user_id);

alter table public.community_rules      enable row level security;
alter table public.community_moderators enable row level security;

drop policy if exists "community rules are publicly readable" on public.community_rules;
create policy "community rules are publicly readable" on public.community_rules
  for select using (true);

drop policy if exists "creator manages own community rules" on public.community_rules;
create policy "creator manages own community rules" on public.community_rules
  for all using (
    exists (select 1 from public.communities c where c.id = community_rules.community_id and c.created_by = auth.uid())
  ) with check (
    exists (select 1 from public.communities c where c.id = community_rules.community_id and c.created_by = auth.uid())
  );

drop policy if exists "community moderators are publicly readable" on public.community_moderators;
create policy "community moderators are publicly readable" on public.community_moderators
  for select using (true);

drop policy if exists "creator manages own community moderators" on public.community_moderators;
create policy "creator manages own community moderators" on public.community_moderators
  for all using (
    exists (select 1 from public.communities c where c.id = community_moderators.community_id and c.created_by = auth.uid())
  ) with check (
    exists (select 1 from public.communities c where c.id = community_moderators.community_id and c.created_by = auth.uid())
  );

do $$
begin
  alter publication supabase_realtime add table public.community_rules;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.community_moderators;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
