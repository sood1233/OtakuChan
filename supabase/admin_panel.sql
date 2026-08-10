-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Admin panel (verify / ban / delete)
-- Locked to ONE account: the profile whose username is "marpe".
-- Run in: Supabase Dashboard → SQL Editor → New query → paste WHOLE
-- file → Run. Safe to re-run any time.
--
-- Run this AFTER schema.sql / MASTER_SCHEMA.sql has already been run
-- at least once (it needs public.profiles and public.posts to exist),
-- and AFTER the @marpe account already exists (sign up on the site
-- first if it doesn't yet — the seed step at the bottom needs to find
-- that row).
--
-- WHY THIS IS "ONLY ME" AND NOT JUST A UI CHECK
--   is_admin() below does two things, not one:
--     1. checks auth.uid() is a row in public.admins (a table no
--        client can ever read or write — RLS on, zero policies, only
--        touchable from the SQL editor / a service_role key)
--     2. re-checks that same account's username is still exactly
--        "marpe"
--   Both have to be true. So even if someone somehow got a second row
--   into public.admins (they can't, from the client — but even if a
--   future edit to this file did it by accident), they still couldn't
--   pass unless their username were also literally "marpe" — and
--   usernames are unique (see MASTER_SCHEMA.sql), so only one account
--   on the whole site can ever satisfy that.
--   admin.html's own gate calls is_admin() the same way — it never
--   trusts anything about "who you are" that came from the browser.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. profiles: verified + banned ──

alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists banned   boolean not null default false;
alter table public.profiles add column if not exists banned_at timestamptz;

-- ── 2. admins allow-list — RLS on, zero policies. No row is
-- selectable/insertable/updatable by anon or authenticated, full
-- stop. Only touchable from the SQL editor / a service_role key.

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- ── 3. is_admin() — true only for the account that is BOTH listed
-- in public.admins AND currently has username = 'marpe'. Every
-- admin_*() action below calls this first.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admins a
    join public.profiles p on p.id = a.user_id
    where a.user_id = auth.uid()
      and lower(p.username) = 'marpe'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── 4. admin_verify_user() — toggles the checkmark badge on ANY
-- account (this is how @marpe verifies other users). ──

create or replace function public.admin_verify_user(target_user_id uuid, make_verified boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set verified = make_verified where id = target_user_id;
  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke all on function public.admin_verify_user(uuid, boolean) from public;
grant execute on function public.admin_verify_user(uuid, boolean) to authenticated;

-- ── 5. admin_ban_user() — sets banned. RLS below stops a banned
-- account from posting/replying immediately; js/auth.js also signs
-- them out client-side the moment their profile loads with banned = true.

create or replace function public.admin_ban_user(target_user_id uuid, make_banned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if target_user_id in (select user_id from public.admins) then
    raise exception 'Refusing to ban an admin account';
  end if;
  update public.profiles
    set banned = make_banned,
        banned_at = case when make_banned then now() else null end
    where id = target_user_id;
  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke all on function public.admin_ban_user(uuid, boolean) from public;
grant execute on function public.admin_ban_user(uuid, boolean) to authenticated;

-- ── 6. admin_delete_post() — soft-deletes ANY post (is_deleted =
-- true), same as the owner's own delete_own_post(), just without the
-- "has to be your own post" check — gated by is_admin() instead.

create or replace function public.admin_delete_post(post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.posts set is_deleted = true where id = post_id;
  if not found then
    raise exception 'Post not found';
  end if;
end;
$$;

revoke all on function public.admin_delete_post(uuid) from public;
grant execute on function public.admin_delete_post(uuid) to authenticated;

-- ── 7. Banned accounts can't post or reply — enforced at the RLS
-- level (not just hidden in the UI). ──

drop policy if exists "logged in users can post" on public.posts;
create policy "logged in users can post" on public.posts
  for insert with check (
    auth.uid() = author_id
    and not exists (select 1 from public.profiles where id = author_id and banned = true)
  );

drop policy if exists "logged in users can reply" on public.replies;
create policy "logged in users can reply" on public.replies
  for insert with check (
    auth.uid() = author_id
    and not exists (select 1 from public.profiles where id = author_id and banned = true)
  );

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 8. SEED @marpe AS THE ADMIN ──
-- Looks the account up by username, not email, since that's how you
-- actually identified "only me" — no email to mistype or keep in
-- sync. If @marpe hasn't signed up yet, this matches zero rows;
-- re-run just this file once the account exists.
-- ═══════════════════════════════════════════════════════════════════

insert into public.admins (user_id)
select id from public.profiles where lower(username) = 'marpe'
on conflict (user_id) do nothing;

-- Sanity check — run separately after, to confirm it worked:
-- select p.username, a.created_at as admin_since
-- from public.admins a join public.profiles p on p.id = a.user_id;
