-- ═══════════════════════════════════════════════════════════════════
-- OTAKUCHAN — Settings & notification preferences
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- Run this AFTER supabase/schema.sql. Safe to re-run (IF NOT EXISTS /
-- OR REPLACE / ON CONFLICT throughout, same pattern as schema.sql).
--
-- Adds the real "options" behind settings.html:
--   - a banner/cover photo on profiles (Twitter-style)
--   - per-user notification toggles (likes / replies / follows)
--   - a "who can message you" privacy setting, actually enforced by
--     the messages table's RLS policy, not just hidden in the UI
-- ═══════════════════════════════════════════════════════════════════

-- Profile banner (cover photo) shown behind the avatar on profile.html
-- and editprofile.html. Uploaded to the existing 'avatars' bucket —
-- same own-folder storage policy as the avatar already covers it, so
-- no bucket/policy changes are needed for this.
alter table public.profiles add column if not exists banner_url text;

-- ───────────────────────────────────────────────────────────────────
-- USER SETTINGS — one row per user. Created automatically the moment
-- a profile is created (trigger below), so the client never has to
-- special-case a "missing settings row."
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  notify_likes    boolean not null default true,
  notify_replies  boolean not null default true,
  notify_follows  boolean not null default true,
  dm_privacy      text not null default 'everyone' check (dm_privacy in ('everyone','following')),
  created_at      timestamptz not null default now()
);

-- Backfill for any accounts that existed before this table did.
insert into public.user_settings (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_new_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

alter table public.user_settings enable row level security;

drop policy if exists "users can read own settings" on public.user_settings;
create policy "users can read own settings" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "users can update own settings" on public.user_settings;
create policy "users can update own settings" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deliberately no insert policy for anon/authenticated — rows are
-- only ever created by the trigger above (security definer), same
-- pattern the notifications table already uses.

-- ───────────────────────────────────────────────────────────────────
-- Wire the notification toggles into the existing like/reply/follow
-- trigger functions from schema.sql — same triggers, just gated by
-- the recipient's saved preference before writing a notifications row.
-- ───────────────────────────────────────────────────────────────────
create or replace function public.on_like_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid; wants boolean;
begin
  update public.posts set like_count = like_count + 1 where id = new.post_id returning author_id into recipient;
  if recipient is not null and recipient <> new.user_id then
    select notify_likes into wants from public.user_settings where user_id = recipient;
    if coalesce(wants, true) then
      insert into public.notifications (user_id, actor_id, type, post_id)
      values (recipient, new.user_id, 'like', new.post_id);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.on_reply_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipient uuid; wants boolean;
begin
  update public.posts set reply_count = reply_count + 1 where id = new.post_id;
  if new.parent_reply_id is not null then
    select author_id into recipient from public.replies where id = new.parent_reply_id;
  else
    select author_id into recipient from public.posts where id = new.post_id;
  end if;
  if recipient is not null and recipient <> new.author_id then
    select notify_replies into wants from public.user_settings where user_id = recipient;
    if coalesce(wants, true) then
      insert into public.notifications (user_id, actor_id, type, post_id, reply_id)
      values (recipient, new.author_id, 'reply', new.post_id, new.id);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.on_follow_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare wants boolean;
begin
  update public.profiles set following_count = following_count + 1 where id = new.follower_id;
  update public.profiles set followers_count = followers_count + 1 where id = new.followee_id;
  select notify_follows into wants from public.user_settings where user_id = new.followee_id;
  if coalesce(wants, true) then
    insert into public.notifications (user_id, actor_id, type)
    values (new.followee_id, new.follower_id, 'follow');
  end if;
  return new;
end; $$;

-- ───────────────────────────────────────────────────────────────────
-- DM PRIVACY — "everyone" (default) or "following" (only people the
-- recipient already follows can message them — mirrors Twitter's
-- "message requests" setting). This is enforced here, at the database
-- level, not just hidden in the UI: it replaces the messages insert
-- policy from schema.sql with one that also checks the recipient's
-- saved preference.
-- ───────────────────────────────────────────────────────────────────
drop policy if exists "logged in users can send messages" on public.messages;
create policy "logged in users can send messages" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and (
      not exists (
        select 1 from public.user_settings
        where user_id = recipient_id and dm_privacy = 'following'
      )
      or exists (
        select 1 from public.follows
        where follower_id = recipient_id and followee_id = sender_id
      )
    )
  );
