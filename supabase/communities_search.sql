-- ═══════════════════════════════════════════════════════════════════
-- INTERACTINK — Communities search
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- (after schema.sql and communities.sql have both already been run).
-- Safe to re-run — IF NOT EXISTS throughout, same style as the rest
-- of the project's SQL files.
--
-- communities.js's ilike('%term%') filter on the "All" tab works
-- without this, it's just a full sequential scan of public.communities
-- until then. Same reasoning as the posts_body_trgm_idx /
-- profiles_username_trgm_idx indexes in schema.sql — this just
-- extends that same trigram-index treatment to name/description.
-- pg_trgm itself is already enabled by schema.sql, so this only adds
-- the two new indexes.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

create index if not exists communities_name_trgm_idx
  on public.communities using gin (name gin_trgm_ops);

create index if not exists communities_description_trgm_idx
  on public.communities using gin (description gin_trgm_ops);
