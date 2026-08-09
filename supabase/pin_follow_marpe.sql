-- ═══════════════════════════════════════════════════════════════════
-- PIN A MANDATORY FOLLOW OF @marpe
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run.
--
-- What this does:
--   1. Every new signup automatically gets a follows row pointing at
--      @marpe, in the same transaction that creates their profile.
--   2. Existing users are backfilled once (everyone who doesn't
--      already follow @marpe gets the row added).
--   3. The RLS policy that lets people unfollow is tightened so a
--      follow row targeting @marpe can never be deleted by its
--      follower. This is the actual guardrail — the UI also disables
--      the button (js/profile.js, js/followlist.js), but that's just
--      UX; someone hitting the API directly is stopped here.
--
-- NOTE: this assumes a profile with username = 'marpe' already
-- exists. If that username ever changes, update the lower('marpe')
-- literals below (in both the function and the policy) to match.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. extend the existing signup trigger to auto-follow @marpe ──
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  marpe_id uuid;
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    new.raw_user_meta_data->>'avatar_url'
  );

  select id into marpe_id from public.profiles where lower(username) = 'marpe';
  if marpe_id is not null and marpe_id <> new.id then
    insert into public.follows (follower_id, followee_id)
    values (new.id, marpe_id)
    on conflict do nothing;
  end if;

  return new;
end; $$;

-- (trigger itself is unchanged — it already points at this function —
-- but re-declared here so this file works standalone too)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. one-time backfill for accounts created before this ran ──
insert into public.follows (follower_id, followee_id)
select p.id, m.id
from public.profiles p
cross join (select id from public.profiles where lower(username) = 'marpe') m
where p.id <> m.id
on conflict do nothing;

-- ── 3. RLS: block deleting a follow row whose followee is @marpe ──
drop policy if exists "users can unfollow" on public.follows;
create policy "users can unfollow" on public.follows
  for delete using (
    auth.uid() = follower_id
    and followee_id <> (select id from public.profiles where lower(username) = 'marpe')
  );
