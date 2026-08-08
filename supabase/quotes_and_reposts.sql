-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Quote posts + Reposts
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

-- widen the notifications type check (originally 'like'/'reply'/'follow' only)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','reply','follow','repost','quote'));

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
