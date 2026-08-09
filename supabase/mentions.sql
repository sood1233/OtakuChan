-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — @Mentions (user tagging)
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
