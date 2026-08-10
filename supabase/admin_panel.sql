-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Admin panel (verify / ban / delete)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste WHOLE
-- file → Run. Safe to re-run any time (drop/create + IF NOT EXISTS
-- throughout, same pattern as the rest of supabase/*.sql).
--
-- Run this AFTER schema.sql / MASTER_SCHEMA.sql has already been run
-- at least once (it needs public.profiles and public.posts to exist).
--
-- WHAT THIS SETS UP
--   • public.admins        — allow-list of who can use admin.html.
--     Nobody can read or write this table from the client, not even
--     an admin — it's only ever touched here, in the SQL editor, with
--     your own Supabase login. That's what makes "only I have
--     access" actually true at the database level, not just because
--     the page happens to check something client-side (client-side
--     checks are trivially bypassed — anyone can open devtools and
--     call the API directly. RLS is what can't be bypassed).
--   • profiles.verified    — powers the checkmark badge (vBadge() in
--     js/common.js already reads this on every profile it renders).
--   • profiles.banned      — blocks posting/replying at the RLS
--     level (not just hidden client-side) and js/auth.js signs the
--     person out the moment their session loads a banned profile.
--   • admin_verify_user() / admin_ban_user() / admin_delete_post()
--     — the only way any of the above three columns/actions change.
--     Each is `security definer` (runs with elevated privilege) but
--     its very first line re-checks is_admin() itself, so calling it
--     as anyone other than the one account in public.admins just
--     raises an exception — granting EXECUTE to "authenticated" is
--     safe for that reason.
--
-- ── ONE-TIME SETUP YOU NEED TO DO ──
-- Near the bottom of this file there's a line like:
--   insert into public.admins (user_id) select id from auth.users
--   where email = 'YOU@EXAMPLE.COM';
-- Replace that email with the email you log into InteractInk with,
-- BEFORE running this file. That's what makes that one account (and
-- only that account) the admin. You can run that insert again later
-- for a second email if you ever want a second admin.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. profiles: verified + banned ──

alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists banned   boolean not null default false;
alter table public.profiles add column if not exists banned_at timestamptz;

-- ── 2. admins allow-list — RLS on, zero policies. That means: no row
-- is selectable/insertable/updatable by anon or authenticated, full
-- stop. The only way in or out is the SQL editor / a service_role
-- key, neither of which the website's frontend ever has.

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- ── 3. is_admin() — the one function allowed to read the admins
-- table (security definer bypasses RLS for its own query only). Every
-- admin_*() action below starts by calling this.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── 4. admin_verify_user() — toggles the checkmark badge. ──

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

-- ── 6. admin_delete_post() — same soft-delete the owner's own
-- delete_own_post() does (sets is_deleted = true), just without the
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
-- level (not just hidden in the UI), by widening the existing insert
-- policies from schema.sql to also require the author isn't banned.

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
-- ── 8. SEED THE ADMIN ──
-- This is the ONLY account that will ever pass is_admin(). Make sure
-- you've created this login first (sign up on the site, or add it
-- via Supabase Dashboard → Authentication → Users), THEN run this
-- whole file. If the account doesn't exist yet, this insert quietly
-- matches zero rows — re-run just this file again after creating it.
-- ═══════════════════════════════════════════════════════════════════

insert into public.admins (user_id)
select id from auth.users where email = 'mohad10alli@gmail.com'
on conflict (user_id) do nothing;

-- Sanity check — run this separately after, to confirm it worked:
-- select u.email, a.created_at as admin_since
-- from public.admins a join auth.users u on u.id = a.user_id;
