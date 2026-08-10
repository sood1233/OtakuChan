-- =====================================================================
-- REMOVE EMAIL VERIFICATION
-- =====================================================================
-- The app's signup form (auth.js: doSignUp) was already built with no
-- verification step — email/username/password → submit → logged in,
-- same as the request describes. That behavior depends on ONE Supabase
-- project setting:
--
--   Authentication → Providers → Email → uncheck "Confirm email"
--
-- Flip that off first — it's the one-click version of this and is what
-- makes sb.auth.signUp() hand back a real session in the same call.
--
-- This script is the belt-and-suspenders version: a trigger that
-- force-confirms every account at the database level, so nobody can
-- ever get stuck "pending confirmation" even if that toggle is left on,
-- gets flipped back on by accident later, or a teammate sets up a new
-- environment and misses the step above.
--
-- Run this once in the Supabase SQL Editor.

-- 1) Auto-confirm every new signup going forward, at the moment the
--    auth.users row is created.
create or replace function public.auto_confirm_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_auto_confirm on auth.users;
create trigger on_auth_user_auto_confirm
  before insert on auth.users
  for each row execute function public.auto_confirm_email();

-- 2) Back-fill anyone who already signed up and is sitting unconfirmed
--    (e.g. accounts created before this trigger existed).
-- Note: auth.users.confirmed_at is a generated column derived from
-- email_confirmed_at/phone_confirmed_at — it updates itself, so it's
-- never set directly here or in the trigger above.
update auth.users
set email_confirmed_at = now()
where email_confirmed_at is null;
