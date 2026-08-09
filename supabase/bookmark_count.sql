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
